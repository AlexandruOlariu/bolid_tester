/** The triage digest with the real composed contributions (final review, finding 6): the two
 *  triage tools `scan_modules` and `read_history` each keep their own section, so a full history on
 *  a Golf with stored codes still reaches the model with its "Recurring:" line, after the module
 *  scan. Lives under test/ because it composes features through the app layer. */
const mockFiles = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => mockFiles.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    mockFiles.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

import {
  CORE_AGENT_CONTRIBUTION,
  DiagnosticSession,
  MockTransport,
  TRIAGE_DIGEST_CHARS,
  buildAgentRegistry,
  buildScenario,
  createReadOnlySession,
  runTriage,
  type AiReport,
  type ToolContext,
} from '@/shared/obd-core';
import { useHistoryStore, type HistoryEntry } from '@/shared/state/historyStore';
import { flushPendingWrites } from '@/shared/state/persistStorage';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { knownChecksFor } from '@/shared/vehicles/agentContext';
import { AGENT_CONTRIBUTIONS } from '@/app/ai-diagnose';

const GOLF = 'golf-plus-2009-20tdi';
const golf = getVehicleProfile(GOLF);
const T0 = new Date(2026, 10, 1, 9, 0).getTime();
const DAY_MS = 86_400_000;
const car = { id: GOLF, label: golf.name, vin: null };

/** Six AI runs with long summaries and six fault-code checks with P0401 each, newest first. */
function fullHistory(): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < 6; i++) {
    entries.push({
      kind: 'ai',
      id: `ai-${i}`,
      ts: T0 + i * 2 * DAY_MS,
      vehicle: car,
      source: 'ai',
      overall: 'attention',
      summary: `EGR flow low, recheck after the drive cycle and inspect the valve. ${'x'.repeat(120)}`,
      findingCount: 2,
      report: {} as AiReport,
    });
    entries.push({
      kind: 'dtc',
      id: `dtc-${i}`,
      ts: T0 + (i * 2 + 1) * DAY_MS,
      vehicle: car,
      milOn: true,
      stored: [
        { code: 'P0401', description: '' },
        { code: 'P2002', description: '' },
      ],
      pending: [],
      permanent: [],
      monitorsComplete: null,
      monitorsTotal: null,
    });
  }
  return entries.sort((a, b) => b.ts - a.ts);
}

async function golfCtx(): Promise<ToolContext> {
  const session = new DiagnosticSession(
    new MockTransport(
      buildScenario(GOLF, {
        storedDtcs: ['P2183', 'P0401'],
        pendingDtcs: ['P2015'],
        permanentDtcs: [],
      }),
    ),
    { commandTimeoutMs: 1000, firstCommandTimeoutMs: 1000 },
  );
  await session.connect();
  let t = T0 + 30 * DAY_MS;
  return {
    session: createReadOnlySession(session),
    profile: golf,
    guideProfileId: golf.id,
    vehicle: { label: golf.name, make: golf.make },
    vin: 'WVWZZZ1KZ9W903398',
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
  };
}

beforeEach(() => {
  mockFiles.clear();
  useGarageStore.setState({ vehicles: [] });
  useVehicleStore.setState({ selectedProfileId: GOLF });
  useHistoryStore.setState({ entries: fullHistory() });
});

afterAll(() => flushPendingWrites());

it('a full history and stored codes: both scan_modules and the Recurring line reach the model', async () => {
  const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
  const t = await runTriage(await golfCtx(), reg, (codes) => knownChecksFor(GOLF, codes));
  const d = t.step.digest;
  expect(d.length).toBeLessThanOrEqual(TRIAGE_DIGEST_CHARS);
  expect(d).toContain('## scan_modules\n');
  expect(d).toContain('## read_history\n');
  expect(d).toContain('Fault-code checks');
  expect(d).toMatch(/Recurring: P0401 \(\d checks\)/);
  expect(d).toContain('Saved module scans:');
});
