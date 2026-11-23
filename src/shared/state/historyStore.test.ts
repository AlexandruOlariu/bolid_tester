/** History retention cap (finding F7), the stored agent trail and the persist migration (plan
 *  34d). The store's persist layer pulls in expo-file-system (ESM, not transformed for the node test
 *  env), so we mock it with an in-memory file map — hydration starts from "nothing persisted", the
 *  synchronous store actions run unaffected, and the migration test can seed an older file. */
const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    files.delete(uri);
  }),
}));

import type { AgentStep } from '@/shared/obd-core';
import { flushPendingWrites } from './persistStorage';
import {
  useHistoryStore,
  MAX_HISTORY,
  MAX_STORED_DIGEST_CHARS,
  MAX_STORED_TRAIL_STEPS,
  toStoredTrail,
  type AiHistoryEntry,
} from './historyStore';

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

  it('addReportRun prepends a kind: report entry under the cap (plan 15)', () => {
    const { addDtcCheck, addReportRun } = useHistoryStore.getState();
    for (let i = 0; i < MAX_HISTORY; i++) addDtcCheck(dtcEntry(i));
    addReportRun({
      ts: 9999,
      vehicle: { id: 'golf-plus-2009-20tdi', label: 'Golf', vin: 'WVWZZZ1KZ9W903398' },
      sections: ['faults', 'scan'],
      format: 'pdf',
      fileName: 'bolid-report-WVWZZZ1KZ9W903398-20261109-0805.pdf',
    });

    const entries = useHistoryStore.getState().entries;
    expect(entries).toHaveLength(MAX_HISTORY);
    expect(entries[0]).toMatchObject({
      kind: 'report',
      ts: 9999,
      sections: ['faults', 'scan'],
      format: 'pdf',
      fileName: 'bolid-report-WVWZZZ1KZ9W903398-20261109-0805.pdf',
    });
    expect(typeof entries[0].id).toBe('string');
    // The oldest check was evicted to make room.
    expect(entries[entries.length - 1].ts).toBe(1);
  });
});

const fileOf = (name: string) => `/tmp/bolid-test/${name}.json`;
function writePersisted(name: string, state: unknown, version: number): void {
  files.set(fileOf(name), JSON.stringify({ state, version }));
}
function readPersisted(name: string): { state: { entries: unknown[] }; version: number } {
  return JSON.parse(files.get(fileOf(name)) ?? 'null');
}

function step(id: number, over: Partial<AgentStep> = {}): AgentStep {
  return {
    id,
    kind: id === 1 ? 'triage' : 'tool',
    tool: id === 1 ? undefined : 'read_live',
    args: { pids: ['010C'] },
    why: `why ${id}`,
    digest: `digest ${id}`,
    summary: `summary ${id}`,
    label: { key: 'aiDiagnose:agent.tool.read_dtcs' },
    status: 'ok',
    durationMs: 120,
    ...over,
  };
}

const report = {
  source: 'ai' as const,
  overall: 'ok' as const,
  summary: 's',
  findings: [],
  actions: [],
  disclaimer: 'd',
};

const aiRunBase = {
  ts: 1,
  vehicle: { id: 'v', label: 'V', vin: null },
  source: 'ai' as const,
  overall: 'ok' as const,
  summary: 's',
  findingCount: 0,
  report,
};

/** An AI entry as saved before plan 34d: no trail, request or end. */
const oldAiEntryWithoutTrail = { kind: 'ai', id: 'old-ai', ...aiRunBase };
const dtcEntryV2 = { kind: 'dtc', id: 'old-dtc', ...dtcEntry(2) };

describe('historyStore agent trail (plan 34d)', () => {
  beforeEach(() => {
    files.clear();
    useHistoryStore.setState({ entries: [] });
  });

  it('toStoredTrail keeps the first 16 steps, cuts long digests with an ellipsis, drops findings and args', () => {
    const trail = Array.from({ length: 20 }, (_, i) =>
      step(i + 1, {
        digest: i === 0 ? 'short' : 'x'.repeat(2000),
        findings: [{ key: 'k', severity: 'warn' }],
        unconfirmed: i === 2 ? true : undefined,
      }),
    );
    const stored = toStoredTrail(trail);
    expect(MAX_STORED_TRAIL_STEPS).toBe(16);
    expect(MAX_STORED_DIGEST_CHARS).toBe(600);
    expect(stored).toHaveLength(16);
    expect(stored.map((r) => r.id)).toEqual(trail.slice(0, 16).map((s) => s.id));
    expect(stored[0].digest).toBe('short');
    expect(stored[1].digest).toBe(`${'x'.repeat(600)}…`);
    expect(stored[2].unconfirmed).toBe(true);
    expect(stored[1]).toEqual({
      id: 2,
      kind: 'tool',
      tool: 'read_live',
      why: 'why 2',
      digest: `${'x'.repeat(600)}…`,
      summary: 'summary 2',
      label: { key: 'aiDiagnose:agent.tool.read_dtcs' },
      status: 'ok',
    });
    expect('findings' in stored[1]).toBe(false);
    expect('args' in stored[1]).toBe(false);
    expect('durationMs' in stored[1]).toBe(false);
  });

  it('stores a bounded trail', () => {
    const trail = Array.from({ length: 20 }, (_, i) =>
      step(i + 1, { digest: 'x'.repeat(2000), findings: [{ key: 'k', severity: 'warn' }] }),
    );
    useHistoryStore.getState().addAiRun({ ...aiRunBase, trail: toStoredTrail(trail) });
    const e = useHistoryStore.getState().entries[0] as AiHistoryEntry;
    expect(e.trail).toHaveLength(16);
    expect(e.trail![0].digest.length).toBeLessThanOrEqual(601);
    expect('findings' in e.trail![0]).toBe(false);
  });

  it('addAiRun bounds a trail handed to it unbounded, and keeps the request and end', () => {
    const trail = Array.from({ length: 13 }, (_, i) =>
      step(i + 1, { digest: 'y'.repeat(5000), findings: [{ key: 'k', severity: 'warn' }] }),
    );
    useHistoryStore.getState().addAiRun({
      ...aiRunBase,
      trail,
      request: { mode: 'symptom', symptom: 'pulls weak', focusCode: 'P0299' },
      end: 'final',
    });
    const e = useHistoryStore.getState().entries[0] as AiHistoryEntry;
    expect(e.trail).toHaveLength(13);
    for (const r of e.trail!) {
      expect(r.digest.length).toBe(601);
      expect('findings' in r).toBe(false);
    }
    expect(e.request).toEqual({ mode: 'symptom', symptom: 'pulls weak', focusCode: 'P0299' });
    expect(e.end).toBe('final');
  });

  it('an AI run without a trail stores none', () => {
    useHistoryStore.getState().addAiRun(aiRunBase);
    const e = useHistoryStore.getState().entries[0] as AiHistoryEntry;
    expect(e.trail).toBeUndefined();
    expect('trail' in e).toBe(false);
  });

  it('migrates a v2 file to v3 keeping every entry', async () => {
    await flushPendingWrites();
    files.clear();
    writePersisted('bolid.history', { entries: [oldAiEntryWithoutTrail, dtcEntryV2] }, 2);
    await useHistoryStore.persist.rehydrate();
    expect(useHistoryStore.getState().entries).toEqual([oldAiEntryWithoutTrail, dtcEntryV2]);
    await flushPendingWrites();
    expect(readPersisted('bolid.history').version).toBe(3);
    expect(readPersisted('bolid.history').state.entries).toHaveLength(2);
  });

  it('still lifts a v1 vehicleLabel entry into a vehicle on the way to v3', async () => {
    await flushPendingWrites();
    files.clear();
    const { vehicle: _vehicle, ...flat } = dtcEntryV2;
    writePersisted('bolid.history', { entries: [{ ...flat, vehicleLabel: 'Golf' }] }, 1);
    await useHistoryStore.persist.rehydrate();
    expect(useHistoryStore.getState().entries[0].vehicle).toEqual({
      id: 'unknown',
      label: 'Golf',
      vin: null,
    });
    await flushPendingWrites();
    expect(readPersisted('bolid.history').version).toBe(3);
  });
});
