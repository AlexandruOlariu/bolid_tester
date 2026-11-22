/** The agent service (plan 34a) against the simulator Golf and the development mock AI server
 *  (`mock://ai`, its scripted agent conversations): the run context comes from the session, the
 *  active profile and the AI settings; every ending carries its notice. The persisted stores' file
 *  system is mocked. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { DiagnosticSession, type AgentProgress, type TriageResult } from '@/shared/obd-core';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { setLanguage } from '@/shared/i18n';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { runTriageOnly, startAgentRun } from './agentService';
import { createDriverGate } from './driverGate';

const GOLF = 'golf-plus-2009-20tdi';
const dev = globalThis as { __DEV__?: boolean };
let hooks: {
  onProgress: (p: AgentProgress) => void;
  onTriage: (t: TriageResult) => void;
  gate: ReturnType<typeof createDriverGate>;
};

async function connectGolf(storedDtcs: string[] = []): Promise<void> {
  const session = new DiagnosticSession(
    new MockTransport(buildScenario(GOLF, { storedDtcs, pendingDtcs: [], permanentDtcs: [] })),
  );
  const info = await session.connect();
  useSessionStore.getState().setConnected(session, info, { id: 'mock', name: 'Simulator' });
}

beforeAll(async () => {
  await setLanguage('en');
});

beforeEach(async () => {
  dev.__DEV__ = true;
  useSessionStore.getState().reset();
  useVehicleStore.setState({ selectedProfileId: GOLF });
  useSettingsStore.setState((s) => ({
    ai: { ...s.ai, enabled: true, provider: 'custom', baseUrl: 'mock://ai', model: '' },
  }));
  hooks = { onProgress: () => undefined, onTriage: () => undefined, gate: createDriverGate() };
  await connectGolf(['P0401']);
});

afterAll(() => {
  delete dev.__DEV__;
});

describe('startAgentRun', () => {
  it('Check everything with mock://ai ends with a cited AI report', async () => {
    const run = startAgentRun({ mode: 'everything' }, [], hooks);
    const o = await run.done;
    expect(o).toMatchObject({ end: 'final', notice: null, report: { source: 'ai' } });
    expect(o.trail.map((s) => s.kind)).toEqual(['triage', 'tool']);
  });

  it('reports triage and progress through the hooks', async () => {
    const triaged: TriageResult[] = [];
    const steps: number[] = [];
    const o = await startAgentRun({ mode: 'everything' }, [], {
      ...hooks,
      onTriage: (t) => triaged.push(t),
      onProgress: (p) => steps.push(p.stepsUsed),
    }).done;
    expect(triaged).toHaveLength(1);
    expect(triaged[0].step).toBe(o.trail[0]);
    expect(triaged[0].snapshot.dtcs.stored.map((d) => d.code)).toEqual(['P0401']);
    // The Golf's curated guide for the read code reaches the snapshot ("Known checks").
    expect(triaged[0].snapshot.guides?.map((g) => g.code)).toEqual(['P0401']);
    expect(steps).toContain(2);
  });

  it('AI off gives the rule report and the no-AI notice', async () => {
    useSettingsStore.setState((s) => ({ ai: { ...s.ai, enabled: false } }));
    const o = await startAgentRun({ mode: 'everything' }, [], hooks).done;
    expect(o.end).toBe('no_ai');
    expect(o.notice).toContain('AI is turned off');
    expect(o.report.source).toBe('local');
  });

  it('stop() ends a looping run as stopped', async () => {
    const run = startAgentRun({ mode: 'symptom', symptom: 'mock:loop' }, [], {
      ...hooks,
      onProgress: (p) => p.stepsUsed === 2 && run.stop(),
    });
    const o = await run.done;
    expect(o.end).toBe('stopped');
    expect(o.notice).toMatch(/You stopped the investigation/);
    expect(o.report.source).toBe('local');
  });

  it('three unusable replies end with the rule report and the invalid notice', async () => {
    const o = await startAgentRun({ mode: 'symptom', symptom: 'mock:invalid' }, [], hooks).done;
    expect(o.end).toBe('invalid');
    expect(o.notice).toMatch(/three unusable replies/);
    expect(o.trail.map((s) => s.kind)).toEqual(['triage', 'invalid', 'invalid', 'invalid']);
  });

  it('throws the connect-first message when no car is connected', () => {
    useSessionStore.getState().reset();
    expect(() => startAgentRun({ mode: 'everything' }, [], hooks)).toThrow(
      'Connect to a vehicle first (Connect tab).',
    );
  });
});

describe('runTriageOnly', () => {
  it('reads the car once and builds the rule report over the triage step', async () => {
    const { triage, report } = await runTriageOnly([]);
    expect(triage.step.kind).toBe('triage');
    expect(report.source).toBe('local');
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.every((f) => f.steps?.includes(1))).toBe(true);
  });
});
