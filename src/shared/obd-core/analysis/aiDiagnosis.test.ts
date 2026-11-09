import {
  normalizeBaseUrl,
  buildChatRequestBody,
  extractMessageContent,
  summarizeSnapshot,
  localHeuristicReport,
  overallFromFindings,
  parseAiReport,
  buildDiagnosisMessages,
  buildFollowUpMessages,
  buildFollowUpSystemPrompt,
  buildSystemPrompt,
  followUpSuggestions,
  MAX_FOLLOWUP_TURNS,
  SUGGESTED_FOLLOWUPS,
  DiagnosticSnapshot,
  AiChatMessage,
  AiFinding,
  AiReport,
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
      extractMessageContent({
        choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }],
      }),
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
        dtcs: {
          stored: [{ code: 'P0299', description: 'Turbo underboost' }],
          pending: [],
          permanent: [],
        },
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
        dtcs: {
          stored: [{ code: 'P0299', description: 'Turbo underboost' }],
          pending: [],
          permanent: [],
        },
        live: [lv('0105', 'Coolant temp', '°C', 121), lv('010C', 'Engine RPM', 'rpm', 900)],
      }),
    );
    expect(r.overall).toBe('urgent');
    expect(r.findings.some((f) => f.severity === 'critical')).toBe(true);
    expect(r.actions.some((a) => a.type === 'clear_dtcs')).toBe(true);
  });

  it('treats a moderately high coolant temp as attention', () => {
    const r = localHeuristicReport(
      snapshot({
        live: [lv('0105', 'Coolant temp', '°C', 108), lv('010C', 'Engine RPM', 'rpm', 820)],
      }),
    );
    expect(r.overall).toBe('attention');
  });

  it('flags low charging voltage only while the engine is running', () => {
    const running = localHeuristicReport(
      snapshot({
        voltage: 12.4,
        live: [lv('010C', 'Engine RPM', 'rpm', 800), lv('0142', 'Module voltage', 'V', 12.4)],
      }),
    );
    expect(running.findings.some((f) => f.title.includes('Charging voltage low'))).toBe(true);

    const off = localHeuristicReport(
      snapshot({
        voltage: 12.4,
        live: [lv('010C', 'Engine RPM', 'rpm', 0), lv('0142', 'Module voltage', 'V', 12.4)],
      }),
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
      findings: [
        { title: 'EGR low flow', severity: 'warn', detail: 'Check EGR.', codes: ['P0401'] },
      ],
      actions: [{ type: 'inspect', label: 'Inspect EGR' }],
    });
    const r = parseAiReport(content, snap);
    expect(r.source).toBe('ai');
    expect(r.overall).toBe('attention');
    expect(r.findings[0].codes).toEqual(['P0401']);
    expect(r.actions[0].type).toBe('inspect');
  });

  it('does not let the model under-report severity below its own findings', () => {
    const content = JSON.stringify({
      overall: 'ok', // model claims OK…
      summary: 'Looks fine.',
      findings: [{ title: 'Coolant overheating', severity: 'critical', detail: 'Very hot.' }], // …but a critical finding
      actions: [],
    });
    expect(parseAiReport(content, snap).overall).toBe('urgent'); // worst of model + findings wins
  });

  it('handles a ```json fenced answer', () => {
    const r = parseAiReport('```json\n{"summary":"ok","findings":[]}\n```', snap);
    expect(r.source).toBe('ai');
    expect(r.summary).toBe('ok');
  });

  it('handles JSON wrapped in prose', () => {
    const r = parseAiReport(
      'Sure! Here you go: {"summary":"hi","findings":[]} — hope that helps',
      snap,
    );
    expect(r.source).toBe('ai');
    expect(r.summary).toBe('hi');
  });

  it('drops unknown action types and coerces invalid severities', () => {
    const content = JSON.stringify({
      summary: 's',
      findings: [{ title: 'x', severity: 'banana', detail: 'd' }],
      actions: [
        { type: 'launch_rocket', label: 'no' },
        { type: 'recheck', label: 'again' },
      ],
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

describe('focused diagnosis (Explain with AI)', () => {
  it('ends with a user message focusing on the code', () => {
    const msgs = buildDiagnosisMessages(snapshot(), { focusCode: 'P0135' });
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('P0135');
    expect(last.content).toMatch(/likely causes in order of probability/);
  });

  it('normalises the code and sends no focus line without one', () => {
    const msgs = buildDiagnosisMessages(snapshot(), { focusCode: ' p0299 ' });
    expect(msgs[msgs.length - 1].content).toContain('P0299');
    expect(buildDiagnosisMessages(snapshot(), { focusCode: '' })).toHaveLength(2);
  });

  it('puts the focused code first in the local report', () => {
    const snap = snapshot({
      dtcs: {
        stored: [
          { code: 'P0299', description: 'Turbo underboost' },
          { code: 'P0135', description: 'O2 heater' },
        ],
        pending: [],
        permanent: [],
      },
    });
    expect(localHeuristicReport(snap).findings[0].codes).toEqual(['P0299']);
    expect(localHeuristicReport(snap, { focusCode: 'P0135' }).findings[0].codes).toEqual(['P0135']);
  });

  it('explains a focused code that is not in the read', () => {
    const r = localHeuristicReport(snapshot(), { focusCode: 'P0135' });
    expect(r.findings[0].title).toContain('P0135');
    expect(r.findings[0].detail).toMatch(/O2 Sensor Heater/i);
    expect(r.overall).toBe('ok');
  });

  it("describes a focused manufacturer code with the car's make", () => {
    const vag = snapshot();
    vag.vehicle = { label: 'VW Golf Plus 2009 (2009)', make: 'vag' };
    expect(localHeuristicReport(vag, { focusCode: 'P1557' }).findings[0].detail).toMatch(
      /charge pressure/i,
    );
    const generic = localHeuristicReport(snapshot(), { focusCode: 'P1557' });
    expect(generic.findings[0].detail).not.toMatch(/charge pressure/i);
  });
});

describe('guide citations (plan 19)', () => {
  const guides = [
    { code: 'P0401', note: 'EGR flow/position fault. Run the EGR valve output test.' },
    { code: 'P2015', note: 'Intake manifold flap (V157). Run the V157 basic setting.' },
  ];

  it('summarizeSnapshot appends the known checks for this car', () => {
    const text = summarizeSnapshot(snapshot(), guides);
    expect(text).toContain('Known checks for this car:');
    expect(text).toContain('- P0401: EGR flow/position fault.');
    expect(text.indexOf('Known checks')).toBeGreaterThan(text.indexOf('Live readings'));
  });

  it('uses the snapshot guides by default and adds nothing without any', () => {
    expect(summarizeSnapshot(snapshot({ guides }))).toContain('- P2015: Intake manifold flap');
    expect(summarizeSnapshot(snapshot())).not.toContain('Known checks');
    expect(buildDiagnosisMessages(snapshot({ guides }))[1].content).toContain('Known checks');
  });

  it('the system prompt asks the model to mention a listed check', () => {
    expect(buildSystemPrompt()).toMatch(/known check.*mention it in `detail`/i);
  });
});

describe('follow-up questions (plan 19)', () => {
  const report: AiReport = {
    overall: 'attention',
    summary: 'EGR needs a look.',
    findings: [{ title: 'EGR', severity: 'warn', detail: 'Flow low', codes: ['P0401'] }],
    actions: [{ type: 'recheck', label: 'Re-run' }],
    source: 'ai',
    disclaimer: 'AI disclaimer',
  };
  const turns = (n: number): AiChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}`,
    }));

  it('system, snapshot, report, conversation, question — in that order', () => {
    const msgs = buildFollowUpMessages(snapshot(), report, turns(2), '  Is it safe to drive? ');
    expect(msgs.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(msgs[1].content).toContain('Vehicle: VW Golf Plus 2009');
    expect(JSON.parse(msgs[2].content)).toEqual({
      overall: 'attention',
      summary: 'EGR needs a look.',
      findings: report.findings,
      actions: report.actions,
    });
    expect(msgs[3].content).toBe('turn 0');
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'Is it safe to drive?' });
  });

  it('keeps only the last MAX_FOLLOWUP_TURNS conversation messages', () => {
    expect(MAX_FOLLOWUP_TURNS).toBe(8);
    const msgs = buildFollowUpMessages(snapshot(), report, turns(10), 'Next?');
    const kept = msgs.slice(3, -1);
    expect(kept).toHaveLength(MAX_FOLLOWUP_TURNS);
    expect(kept[0].content).toBe('turn 2'); // turns 0 and 1 dropped
    expect(kept[0].role).toBe('user');
  });

  it('the follow-up system prompt has no JSON schema hint and asks for a short plain answer', () => {
    const sys = buildFollowUpSystemPrompt();
    expect(sys).not.toContain('Return ONLY a JSON object');
    expect(sys).not.toContain('"findings"');
    expect(sys).toMatch(/120 words/);
    expect(sys).toMatch(/cite codes by id/);
    expect(buildSystemPrompt()).toContain('Return ONLY a JSON object');
  });

  it('suggestions resolve {code} from the report, or drop it', () => {
    expect(SUGGESTED_FOLLOWUPS).toContain('What does {code} mean for this car?');
    expect(followUpSuggestions(report)).toEqual([
      'What should I check first?',
      'Is it safe to drive?',
      'Which finding is most urgent?',
      'What does P0401 mean for this car?',
    ]);
    const noCodes = followUpSuggestions({ ...report, findings: [] });
    expect(noCodes).toHaveLength(3);
    expect(noCodes.join(' ')).not.toContain('{code}');
  });

  it('a focus code puts its question first', () => {
    const s = followUpSuggestions(report, 'p2015');
    expect(s[0]).toBe('What does P2015 mean for this car?');
    expect(s.filter((q) => q.startsWith('What does'))).toHaveLength(1);
  });
});
