import { localHeuristicReport, type DiagnosticSnapshot } from '../analysis/aiDiagnosis';
import { agentRuleReport, parseAgentFinal } from './report';
import type { AgentStep, FindingTranslator } from './types';

function step(id: number, over: Partial<AgentStep> = {}): AgentStep {
  return {
    id,
    kind: id === 1 ? 'triage' : 'tool',
    tool: id === 1 ? undefined : 'read_live',
    why: '',
    digest: `digest ${id}`,
    summary: `summary ${id}`,
    label: { key: 'aiDiagnose:agent.tool.read_live' },
    status: 'ok',
    durationMs: 10,
    ...over,
  };
}

function snapshotWith(stored: string[]): DiagnosticSnapshot {
  return {
    protocol: 'ISO_15765_4_CAN_11_500',
    vin: null,
    voltage: 12.6,
    supportedPidCount: 20,
    readiness: null,
    dtcs: {
      stored: stored.map((code) => ({ code, description: `${code} description` })),
      pending: [],
      permanent: [],
    },
    freezeFrame: null,
    live: [],
  };
}

const translate: FindingTranslator = (f) => ({ title: `T:${f.key}`, detail: 'D' });

describe('parseAgentFinal', () => {
  it('drops findings that cite nothing, unknown or failed steps', () => {
    const trail = [step(1), step(2, { status: 'error' }), step(3)];
    const r = parseAgentFinal(
      {
        summary: 's',
        findings: [
          { title: 'a', severity: 'warn', detail: 'd', steps: [3] },
          { title: 'b', severity: 'warn', detail: 'd' },
          { title: 'c', severity: 'warn', detail: 'd', steps: [2, 9] },
        ],
      },
      trail,
    )!;
    expect(r.findings.map((f) => f.title)).toEqual(['a']);
    expect(r.uncitedDropped).toBe(2);
  });
  it('treats refused and cant steps, fractions and strings as uncited', () => {
    const trail = [
      step(1),
      step(2, { kind: 'driver', status: 'refused' }),
      step(3, { kind: 'driver', status: 'cant' }),
    ];
    const r = parseAgentFinal(
      {
        summary: 's',
        findings: [
          { title: 'a', severity: 'warn', detail: 'd', steps: [2, 3] },
          { title: 'b', severity: 'warn', detail: 'd', steps: [1.5, '1'] },
          { title: 'c', severity: 'warn', detail: 'd', steps: 1 },
        ],
      },
      trail,
    )!;
    expect(r.findings).toEqual([]);
    expect(r.uncitedDropped).toBe(3);
    expect(r.summary).toBe('s');
  });
  it('keeps only the valid cited steps, de-duplicated', () => {
    const r = parseAgentFinal(
      {
        summary: 's',
        findings: [{ title: 'a', severity: 'warn', detail: 'd', steps: [3, 9, 1, 3] }],
      },
      [step(1), step(2), step(3)],
    )!;
    expect(r.findings[0].steps).toEqual([3, 1]);
    expect(r).not.toHaveProperty('uncitedDropped');
  });
  it('caps a finding resting only on unconfirmed data at info, and overall follows', () => {
    const r = parseAgentFinal(
      {
        overall: 'urgent',
        summary: 's',
        findings: [{ title: 'dpf', severity: 'critical', detail: 'd', steps: [2] }],
      },
      [step(1), step(2, { unconfirmed: true })],
    )!;
    expect(r.findings[0]).toMatchObject({ severity: 'info', unconfirmed: true });
    expect(r.overall).toBe('ok');
  });
  it('does not cap a finding that also rests on confirmed data', () => {
    const r = parseAgentFinal(
      {
        summary: 's',
        findings: [{ title: 'dpf', severity: 'critical', detail: 'd', steps: [1, 2] }],
      },
      [step(1), step(2, { unconfirmed: true })],
    )!;
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0]).not.toHaveProperty('unconfirmed');
    expect(r.overall).toBe('urgent');
  });
  it('caps a finding citing triage whose codes come only from an unconfirmed module scan', () => {
    const triage = step(1, {
      confirmedCodes: ['P0401'],
      findings: [
        {
          key: 'moduleScan:agent.finding.moduleDtcs',
          severity: 'warn',
          values: { module: '03 ABS', count: 1 },
          codes: ['C0130'],
          unconfirmed: true,
        },
      ],
    });
    const r = parseAgentFinal(
      {
        summary: 's',
        findings: [
          { title: 'ABS fault', severity: 'critical', detail: 'd', codes: ['C0130'], steps: [1] },
          { title: 'EGR', severity: 'warn', detail: 'd', codes: ['P0401'], steps: [1] },
          { title: 'general', severity: 'warn', detail: 'd', steps: [1] },
        ],
      },
      [triage],
    )!;
    expect(r.findings[0]).toMatchObject({ severity: 'info', unconfirmed: true });
    expect(r.findings[1].severity).toBe('warn');
    expect(r.findings[1]).not.toHaveProperty('unconfirmed');
    expect(r.findings[2].severity).toBe('warn');
  });
  it('does not cap a code that a confirmed finding or read also reports', () => {
    const triage = step(1, {
      confirmedCodes: ['P0401'],
      findings: [
        {
          key: 'moduleScan:agent.finding.moduleDtcs',
          severity: 'warn',
          values: {},
          codes: ['P0401'],
          unconfirmed: true,
        },
      ],
    });
    const r = parseAgentFinal(
      {
        summary: 's',
        findings: [{ title: 'EGR', severity: 'warn', detail: 'd', codes: ['p0401'], steps: [1] }],
      },
      [triage],
    )!;
    expect(r.findings[0].severity).toBe('warn');
  });
  it('builds an ai report with sanitized actions and the AI disclaimer', () => {
    const r = parseAgentFinal(
      {
        summary: '  EGR flow low.  ',
        findings: [{ title: 'EGR', severity: 'warn', detail: 'd', codes: ['P0401'], steps: [1] }],
        actions: [{ type: 'inspect', label: 'Inspect EGR' }, { type: 'reflash' }],
      },
      [step(1)],
    )!;
    expect(r.source).toBe('ai');
    expect(r.summary).toBe('EGR flow low.');
    expect(r.overall).toBe('attention');
    expect(r.findings[0]).toMatchObject({ codes: ['P0401'], steps: [1] });
    expect(r.actions).toEqual([{ type: 'inspect', label: 'Inspect EGR', detail: undefined }]);
    expect(r.disclaimer).toMatch(/AI-generated/);
  });
  it('a summary-only final is a report', () => {
    const r = parseAgentFinal({ summary: 'All good.' }, [step(1)])!;
    expect(r).toMatchObject({ overall: 'ok', summary: 'All good.', findings: [], actions: [] });
  });
  it('returns null for an empty final', () => expect(parseAgentFinal({}, [step(1)])).toBeNull());
  it('returns null when every finding was dropped and there is no summary', () =>
    expect(
      parseAgentFinal({ findings: [{ title: 'a', severity: 'warn', detail: 'd' }] }, [step(1)]),
    ).toBeNull());
  it('returns null for a non-object final', () => {
    expect(parseAgentFinal(null, [step(1)])).toBeNull();
    expect(parseAgentFinal('done', [step(1)])).toBeNull();
    expect(parseAgentFinal([{ summary: 's' }], [step(1)])).toBeNull();
  });
});

describe('agentRuleReport', () => {
  it('the rule report cites triage and adds translated skill findings', () => {
    const r = agentRuleReport(
      snapshotWith(['P0401']),
      [step(1), step(2, { findings: [{ key: 'k', severity: 'warn' }] })],
      { translate: (f) => ({ title: `T:${f.key}`, detail: 'D' }) },
    );
    expect(r.source).toBe('local');
    expect(r.findings.find((f) => f.codes?.includes('P0401'))?.steps).toEqual([1]);
    expect(r.findings.find((f) => f.title === 'T:k')?.steps).toEqual([2]);
  });
  it('every rule finding cites triage and the focus code goes first', () => {
    const snap = snapshotWith(['P0401', 'P0299']);
    const r = agentRuleReport(snap, [step(1)], { focusCode: 'P0299', translate });
    expect(r.findings.every((f) => f.steps?.[0] === 1)).toBe(true);
    expect(r.findings[0].codes).toEqual(['P0299']);
    expect(r.findings).toHaveLength(localHeuristicReport(snap).findings.length);
  });
  it('triage findings cite step 1 and keep their codes', () => {
    const r = agentRuleReport(
      snapshotWith([]),
      [step(1, { findings: [{ key: 'egr', severity: 'info', codes: ['P0401'] }] })],
      { translate },
    );
    expect(r.findings).toEqual([
      { title: 'T:egr', severity: 'info', detail: 'D', codes: ['P0401'], steps: [1] },
    ]);
  });
  it('caps unconfirmed skill findings at info and tags them', () => {
    const r = agentRuleReport(
      snapshotWith([]),
      [
        step(1),
        step(2, { findings: [{ key: 'dpf', severity: 'critical', unconfirmed: true }] }),
        step(3, { unconfirmed: true, findings: [{ key: 'map', severity: 'warn' }] }),
      ],
      { translate },
    );
    expect(r.findings.find((f) => f.title === 'T:dpf')).toMatchObject({
      severity: 'info',
      unconfirmed: true,
      steps: [2],
    });
    expect(r.findings.find((f) => f.title === 'T:map')).toMatchObject({
      severity: 'info',
      unconfirmed: true,
      steps: [3],
    });
    expect(r.overall).toBe('ok');
  });
  it('overall and summary follow the skill findings', () => {
    const r = agentRuleReport(
      snapshotWith([]),
      [step(1), step(2, { findings: [{ key: 'battery.weak', severity: 'critical' }] })],
      { translate },
    );
    expect(r.overall).toBe('urgent');
    expect(r.summary).not.toBe(localHeuristicReport(snapshotWith([])).summary);
    expect(r.summary).toMatch(/urgent/);
  });
});
