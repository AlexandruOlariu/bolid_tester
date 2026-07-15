/** History retention cap (finding F7). The store's persist layer pulls in expo-file-system (ESM,
 *  not transformed for the node test env), so we mock it to a no-op file system — hydration then
 *  resolves to "nothing persisted" and the synchronous store actions under test run unaffected. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { useHistoryStore, MAX_HISTORY } from './historyStore';

function dtcEntry(ts: number) {
  return {
    ts,
    vehicle: { id: 'v', label: 'V', vin: null },
    milOn: false,
    stored: [],
    pending: [],
    permanent: [],
    monitorsComplete: null,
    monitorsTotal: null,
  };
}

describe('historyStore retention', () => {
  beforeEach(() => useHistoryStore.setState({ entries: [] }));

  it('caps entries at MAX_HISTORY, evicting the oldest (newest-first)', () => {
    const { addDtcCheck } = useHistoryStore.getState();
    const total = MAX_HISTORY + 25;
    for (let i = 0; i < total; i++) addDtcCheck(dtcEntry(i));

    const entries = useHistoryStore.getState().entries;
    expect(entries).toHaveLength(MAX_HISTORY);
    // Newest-first: the last-added entry is at the front, and the oldest 25 were evicted.
    expect(entries[0].ts).toBe(total - 1);
    expect(entries[entries.length - 1].ts).toBe(total - MAX_HISTORY);
  });

  it('keeps AI entries capped too, without stripping the embedded report', () => {
    const { addAiRun } = useHistoryStore.getState();
    const report = { source: 'ai' as const, overall: 'ok', summary: 's', findings: [] } as never;
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      addAiRun({
        ts: i,
        vehicle: { id: 'v', label: 'V', vin: null },
        source: 'ai',
        overall: 'ok',
        summary: 's',
        findingCount: 0,
        report,
      });
    }
    const entries = useHistoryStore.getState().entries;
    expect(entries).toHaveLength(MAX_HISTORY);
    expect(entries[0].kind).toBe('ai');
    expect((entries[0] as { report: unknown }).report).toBe(report);
  });
});
