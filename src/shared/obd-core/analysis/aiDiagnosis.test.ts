import {
  normalizeBaseUrl,
  buildChatRequestBody,
  extractMessageContent,
  summarizeSnapshot,
  localHeuristicReport,
  overallFromFindings,
  parseAiReport,
  buildDiagnosisMessages,
  DiagnosticSnapshot,
  AiChatMessage,
  AiFinding,
} from './aiDiagnosis';
import type { LiveValue } from '../session/DiagnosticSession';

const lv = (pid: string, name: string, unit: string, value: number): LiveValue => ({
  pid,
  name,
  unit,
  value,
  ts: 0,
});

function snapshot(over: Partial<DiagnosticSnapshot> = {}): DiagnosticSnapshot {
  return {
    protocol: 'ISO_15765_4_CAN_11_500',
    vin: 'WVWZZZ1KZ9W000001',
    voltage: 14.1,
    supportedPidCount: 20,
    readiness: {
      milOn: false,
      dtcCount: 0,
      ignition: 'compression',
      monitors: [{ id: 'misfire', name: 'Misfire', supported: true, complete: true }],
    },
    dtcs: { stored: [], pending: [], permanent: [] },
    freezeFrame: null,
    live: [lv('0105', 'Coolant temp', '°C', 88), lv('010C', 'Engine RPM', 'rpm', 820)],
    vehicle: {
      label: 'VW Golf Plus 2009 (2009)',
      year: 2009,
      engine: '2.0 TDI 81 kW',
      fuel: 'diesel',
      expectedProtocol: 'ISO_15765_4_CAN_11_500',
      notes: 'CAN diesel; full generic live data.',
    },
    ...over,
  };
}

describe('normalizeBaseUrl', () => {
  it('appends /v1 and strips trailing slashes', () => {
    expect(normalizeBaseUrl('http://192.168.1.50:1234')).toBe('http://192.168.1.50:1234/v1');
    expect(normalizeBaseUrl('http://host:1234/')).toBe('http://host:1234/v1');
  });
  it('leaves an existing version segment', () => {
    expect(normalizeBaseUrl('http://host:1234/v1')).toBe('http://host:1234/v1');
    expect(normalizeBaseUrl('http://host:1234/v1/')).toBe('http://host:1234/v1');
  });
  it('returns empty for blank input', () => {
    expect(normalizeBaseUrl('')).toBe('');
    expect(normalizeBaseUrl('   ')).toBe('');
  });
});

describe('buildChatRequestBody', () => {
  const messages: AiChatMessage[] = [{ role: 'user', content: 'hi' }];
  it('defaults to json_schema structured output and does not send temperature', () => {
    const body = buildChatRequestBody(messages, { baseUrl: 'x', model: 'qwen2.5' });
    expect(body.model).toBe('qwen2.5');
    expect(body.messages).toBe(messages);
    expect(body.temperature).toBeUndefined();
    expect((body.response_format as { type: string }).type).toBe('json_schema');
  });
  it('uses json_object when mode is "object"', () => {
    const body = buildChatRequestBody(messages, { baseUrl: 'x', model: 'm', jsonMode: 'object' });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
  it('omits response_format when mode is "off"', () => {
    const body = buildChatRequestBody(messages, { baseUrl: 'x', model: 'm', jsonMode: 'off' });
    expect(body.response_format).toBeUndefined();
  });
});

describe('extractMessageContent', () => {
  it('reads a plain string content', () => {
    expect(extractMessageContent({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });
  it('joins an array-of-parts content', () => {
    expect(
      extractMessageContent({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }),
    ).toBe('ab');
  });
  it('returns null when absent', () => {
    expect(extractMessageContent({})).toBeNull();
    expect(extractMessageContent({ choices: [] })).toBeNull();
  });
});

describe('summarizeSnapshot', () => {
  it('includes MIL state, DTCs with descriptions, and live readings', () => {
    const text = summarizeSnapshot(
      snapshot({
        readiness: {
          milOn: true,
          dtcCount: 1,
          ignition: 'compression',
          monitors: [{ id: 'egr', name: 'EGR/VVT system', supported: true, complete: false }],
        },
        dtcs: { stored: [{ code: 'P0299', description: 'Turbo underboost' }], pending: [], permanent: [] },
      }),
    );
    expect(text).toContain('MIL (check-engine light): ON');
    expect(text).toContain('P0299 — Turbo underboost');
    expect(text).toContain('Coolant temp: 88 °C');
    expect(text).toContain('Monitors not ready: EGR/VVT system');
  });

  it('puts the vehicle details (label, engine, fuel, notes) at the top as context', () => {
    const text = summarizeSnapshot(snapshot());
    expect(text).toContain('Vehicle: VW Golf Plus 2009 (2009)');
    expect(text).toContain('engine 2.0 TDI 81 kW');
    expect(text).toContain('fuel diesel');
    expect(text).toContain('Profile notes: CAN diesel');
  });

  it('falls back to a generic label when no vehicle context is present', () => {
    const text = summarizeSnapshot(snapshot({ vehicle: undefined }));
    expect(text).toContain('Vehicle: unknown / generic OBD2');
  });
});

describe('localHeuristicReport', () => {
  it('returns overall ok with no findings for a clean car', () => {
    const r = localHeuristicReport(snapshot());
    expect(r.overall).toBe('ok');
    expect(r.findings).toHaveLength(0);
    expect(r.source).toBe('local');
    expect(r.summary.toLowerCase()).toContain('no problems');
  });

  it('flags MIL + stored code + overheating as urgent and offers clear_dtcs', () => {
    const r = localHeuristicReport(
      snapshot({
        readiness: { milOn: true, dtcCount: 1, ignition: 'compression', monitors: [] },
        dtcs: { stored: [{ code: 'P0299', description: 'Turbo underboost' }], pending: [], permanent: [] },
        live: [lv('0105', 'Coolant temp', '°C', 121), lv('010C', 'Engine RPM', 'rpm', 900)],
      }),
    );
    expect(r.overall).toBe('urgent');
    expect(r.findings.some((f) => f.severity === 'critical')).toBe(true);
    expect(r.actions.some((a) => a.type === 'clear_dtcs')).toBe(true);
  });

  it('treats a moderately high coolant temp as attention', () => {
    const r = localHeuristicReport(
      snapshot({ live: [lv('0105', 'Coolant temp', '°C', 108), lv('010C', 'Engine RPM', 'rpm', 820)] }),
    );
    expect(r.overall).toBe('attention');
  });

  it('flags low charging voltage only while the engine is running', () => {
    const running = localHeuristicReport(
      snapshot({ voltage: 12.4, live: [lv('010C', 'Engine RPM', 'rpm', 800), lv('0142', 'Module voltage', 'V', 12.4)] }),
    );
    expect(running.findings.some((f) => f.title.includes('Charging voltage low'))).toBe(true);

    const off = localHeuristicReport(
      snapshot({ voltage: 12.4, live: [lv('010C', 'Engine RPM', 'rpm', 0), lv('0142', 'Module voltage', 'V', 12.4)] }),
    );
    expect(off.findings.some((f) => f.title.includes('Charging voltage low'))).toBe(false);
  });
});

describe('overallFromFindings', () => {
  const f = (severity: AiFinding['severity']): AiFinding => ({ title: 't', severity, detail: 'd' });
  it('ranks critical > warn > ok', () => {
    expect(overallFromFindings([f('info'), f('critical'), f('warn')])).toBe('urgent');
    expect(overallFromFindings([f('info'), f('warn')])).toBe('attention');
    expect(overallFromFindings([f('info'), f('ok')])).toBe('ok');
    expect(overallFromFindings([])).toBe('ok');
  });
});

describe('parseAiReport', () => {
  const snap = snapshot();

  it('parses a clean JSON report and marks it ai-sourced', () => {
    const content = JSON.stringify({
      overall: 'attention',
      summary: 'One issue found.',
      findings: [{ title: 'EGR low flow', severity: 'warn', detail: 'Check EGR.', codes: ['P0401'] }],
      actions: [{ type: 'inspect', label: 'Inspect EGR' }],
    });
    const r = parseAiReport(content, snap);
    expect(r.source).toBe('ai');
    expect(r.overall).toBe('attention');
    expect(r.findings[0].codes).toEqual(['P0401']);
    expect(r.actions[0].type).toBe('inspect');
  });

  it('handles a ```json fenced answer', () => {
    const r = parseAiReport('```json\n{"summary":"ok","findings":[]}\n```', snap);
    expect(r.source).toBe('ai');
    expect(r.summary).toBe('ok');
  });

  it('handles JSON wrapped in prose', () => {
    const r = parseAiReport('Sure! Here you go: {"summary":"hi","findings":[]} — hope that helps', snap);
    expect(r.source).toBe('ai');
    expect(r.summary).toBe('hi');
  });

  it('drops unknown action types and coerces invalid severities', () => {
    const content = JSON.stringify({
      summary: 's',
      findings: [{ title: 'x', severity: 'banana', detail: 'd' }],
      actions: [{ type: 'launch_rocket', label: 'no' }, { type: 'recheck', label: 'again' }],
    });
    const r = parseAiReport(content, snap);
    expect(r.findings[0].severity).toBe('info');
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].type).toBe('recheck');
  });

  it('falls back to the local report on empty or unparseable content', () => {
    expect(parseAiReport(null, snap).source).toBe('local');
    expect(parseAiReport('not json at all', snap).source).toBe('local');
    expect(parseAiReport('{ broken json', snap).source).toBe('local');
    expect(parseAiReport('{}', snap).source).toBe('local'); // no summary, no findings
  });
});

describe('buildDiagnosisMessages', () => {
  it('produces a system + user pair carrying the snapshot summary', () => {
    const msgs = buildDiagnosisMessages(snapshot());
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    expect(msgs[1].content).toContain('Coolant temp: 88 °C');
    expect(msgs[1].content).toContain('Vehicle: VW Golf Plus 2009 (2009)');
    expect(msgs[0].content).toContain('JSON');
  });
});
