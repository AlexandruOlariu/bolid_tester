import {
  buildAgentSharePackage,
  SHARE_PACKAGE_MAX_CHARS,
  VIN_HIDDEN,
  type AgentShareInput,
} from './agentShare';
import type { TrailRow } from '@/shared/state/historyStore';
import type { AiReport } from '@/shared/obd-core';

function row(id: number, over: Partial<TrailRow> = {}): TrailRow {
  return {
    id,
    kind: id === 1 ? 'triage' : 'tool',
    ...(id === 1 ? {} : { tool: 'read_live' }),
    why: id === 1 ? 'Read the car first.' : 'Check the idle readings.',
    digest: `digest ${id}`,
    summary: `summary ${id}`,
    label: { key: 'aiDiagnose:agent.step.triage' },
    status: 'ok',
    ...over,
  };
}

const report: AiReport = {
  overall: 'attention',
  summary: 'EGR flow is low.',
  findings: [
    {
      title: 'EGR flow insufficient',
      severity: 'warn',
      detail: 'P0401 is stored and the EGR position barely moves.',
      codes: ['P0401'],
      likelyCauses: ['Sooted EGR valve'],
      steps: [1, 2],
    },
    {
      title: 'Idle a bit rough',
      severity: 'info',
      detail: 'One reading only.',
      steps: [2],
      unconfirmed: true,
    },
  ],
  actions: [],
  source: 'ai',
  disclaimer: 'Informational only — not a substitute for a professional inspection.',
};

const input: AgentShareInput = {
  vehicleLabel: 'VW Golf Plus 2.0 TDI (2009)',
  vin: null,
  generatedAt: Date.UTC(2026, 10, 23, 10, 15),
  report,
  dtcs: {
    stored: [{ code: 'P0401', description: 'EGR flow insufficient' }],
    pending: [],
    permanent: [],
  },
  trail: [row(1)],
  request: { mode: 'everything' },
};

const inputWithReport: AgentShareInput = { ...input, trail: [row(1), row(2)] };

const hugeInput: AgentShareInput = {
  ...input,
  trail: Array.from({ length: 16 }, (_, i) => row(i + 1, { digest: 'x'.repeat(5_000) })),
};

const vin = 'WVWZZZ1KZ9W903398';

describe('buildAgentSharePackage', () => {
  it('starts with the instruction header for the other assistant', () => {
    const text = buildAgentSharePackage(input, { includeVin: false });
    expect(text.startsWith('I used the Bolid Tester app to read my car over OBD2.')).toBe(true);
    expect(text).toContain(
      'You cannot ask the app for new readings; tell me what to check and I will report back.',
    );
  });

  it('leaves the VIN out everywhere by default', () => {
    const text = buildAgentSharePackage(
      { ...input, vin, trail: [row(1, { digest: `VIN: ${vin}\nStored DTCs (1): P0401` })] },
      { includeVin: false },
    );
    expect(text).not.toContain(vin);
    expect(text).toContain(VIN_HIDDEN);
    expect(text).not.toMatch(/^VIN:/m);
  });

  it('hides the known VIN in any case and inside a longer word, and any other VIN it finds', () => {
    const other = 'WVWZZZ3BZ4E342958';
    const text = buildAgentSharePackage(
      {
        ...input,
        vin,
        trail: [row(1, { digest: `raw ${vin.toLowerCase()} id=${vin}X; other car ${other}` })],
      },
      { includeVin: false },
    );
    expect(text.toUpperCase()).not.toContain(vin);
    expect(text).not.toContain(other);
  });

  it('includes the VIN when switched on', () =>
    expect(buildAgentSharePackage({ ...input, vin }, { includeVin: true })).toContain(
      `VIN: ${vin}`,
    ));

  it('has no VIN line when the car reported none', () =>
    expect(buildAgentSharePackage(input, { includeVin: true })).not.toMatch(/^VIN:/m));

  it('carries the codes, the findings with their steps and every check', () => {
    const t = buildAgentSharePackage(inputWithReport, { includeVin: false });
    expect(t).toContain('P0401');
    expect(t).toContain('based on steps 1, 2');
    expect(t).toContain('Step 1 — Triage — Read the car first.');
    expect(t).toContain('Step 2 — read_live —');
    expect(t).toContain('digest 2');
    expect(t).toContain('(unconfirmed data)');
    expect(t).toContain('Complaint: Check everything');
    expect(t).toContain('Vehicle: VW Golf Plus 2.0 TDI (2009)');
    expect(t).toContain('Pending: none');
    expect(t.trimEnd().endsWith(report.disclaimer)).toBe(true);
  });

  it('names the symptom or the focus code as the complaint', () => {
    expect(
      buildAgentSharePackage(
        { ...input, request: { mode: 'symptom', symptom: 'pulls weak above 2000 rpm' } },
        { includeVin: false },
      ),
    ).toContain('Complaint: pulls weak above 2000 rpm');
    expect(
      buildAgentSharePackage(
        { ...input, request: { mode: 'symptom', symptom: 'P0401', focusCode: 'P0401' } },
        { includeVin: false },
      ),
    ).toMatch(/^Complaint: explain fault code P0401$/m);
  });

  it('is clamped', () => {
    const text = buildAgentSharePackage(hugeInput, { includeVin: false });
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text.length).toBeLessThanOrEqual(SHARE_PACKAGE_MAX_CHARS);
    expect(text.endsWith('… (cut to fit)')).toBe(true);
  });

  it('a VIN at the cut is hidden before the text is clamped', () => {
    const text = buildAgentSharePackage(
      {
        ...hugeInput,
        vin,
        trail: [row(1, { digest: `${'y'.repeat(19_000)} ${vin.repeat(200)}` })],
      },
      { includeVin: false },
    );
    expect(text).not.toMatch(/WVWZZZ/);
  });
});
