import {
  BACKUP_FORMAT,
  backupFileName,
  buildBackup,
  countItems,
  envelopeFor,
  estimateBundleBytes,
  formatBytes,
  parseBackup,
  parseEnvelope,
  planRestore,
  preRestoreFileName,
  preRestoreFilesToDelete,
  redactState,
  uniqueFileName,
  redactBackup,
  serializeBackup,
  utf8Bytes,
  validateBackup,
  type BackupBundle,
} from './backup';

const APP = { version: '0.9.0', platform: 'android' };
const KNOWN = ['bolid.settings', 'bolid.history', 'bolid.scans', 'bolid.trips'];

function bundle(over: Partial<BackupBundle> = {}): BackupBundle {
  return {
    format: BACKUP_FORMAT,
    createdAt: 1_700_000_000_000,
    app: APP,
    stores: [
      { name: 'bolid.history', version: 2, state: { entries: [{ id: 'a' }, { id: 'b' }] } },
      { name: 'bolid.scans', version: 1, state: { scans: [] } },
    ],
    sizes: { storesBytes: 0, tripBytes: 0 },
    ...over,
  };
}

describe('parseEnvelope', () => {
  it('reads state and version', () => {
    expect(parseEnvelope('{"state":{"x":1},"version":3}')).toEqual({ state: { x: 1 }, version: 3 });
  });

  it('treats a missing version as 0 (a store declared without one)', () => {
    expect(parseEnvelope('{"state":{"scans":[]}}')).toEqual({ state: { scans: [] }, version: 0 });
  });

  it('returns null for garbage or a non-envelope', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('[1,2]')).toBeNull();
    expect(parseEnvelope('{"version":1}')).toBeNull();
    expect(parseEnvelope('null')).toBeNull();
  });
});

describe('envelopeFor', () => {
  it('round-trips through parseEnvelope', () => {
    const blob = { name: 'bolid.history', version: 2, state: { entries: [{ id: 'x', ts: 1 }] } };
    const once = envelopeFor(blob);
    const back = parseEnvelope(once);
    expect(back).toEqual({ state: blob.state, version: 2 });
    expect(envelopeFor({ name: blob.name, ...back! })).toBe(once);
  });
});

describe('buildBackup', () => {
  it('skips absent and unreadable files and sums the sizes', () => {
    const history = '{"state":{"entries":[]},"version":2}';
    const scans = '{"state":{"scans":[]}}';
    const b = buildBackup(
      [
        { name: 'bolid.history', raw: history },
        { name: 'bolid.trips', raw: null },
        { name: 'bolid.scans', raw: scans },
        { name: 'bolid.broken', raw: '{oops' },
      ],
      [{ id: '1', csv: 'a,b\n1,2\n' }],
      APP,
      42,
    );
    expect(b.format).toBe(1);
    expect(b.createdAt).toBe(42);
    expect(b.stores.map((s) => s.name)).toEqual(['bolid.history', 'bolid.scans']);
    expect(b.stores[1].version).toBe(0);
    expect(b.sizes).toEqual({ storesBytes: history.length + scans.length, tripBytes: 8 });
    expect(b.tripFiles).toHaveLength(1);
  });

  it('leaves tripFiles out when there are none', () => {
    expect('tripFiles' in buildBackup([], [], APP, 1)).toBe(false);
  });
});

describe('redactBackup', () => {
  it('blanks a legacy plaintext apiKey and leaves the other blobs byte-identical', () => {
    const history = { name: 'bolid.history', version: 2, state: { entries: [{ id: 'a' }] } };
    const b = bundle({
      stores: [
        {
          name: 'bolid.settings',
          version: 3,
          state: { theme: 'dark', ai: { provider: 'openai', apiKey: 'sk-secret', model: 'm' } },
        },
        history,
      ],
    });
    const before = JSON.stringify(history);
    const r = redactBackup(b);
    expect(JSON.stringify(r)).not.toContain('sk-secret');
    expect((r.stores[0].state as { ai: { apiKey: string; model: string } }).ai).toEqual({
      provider: 'openai',
      apiKey: '',
      model: 'm',
    });
    expect(r.stores[1]).toBe(history);
    expect(JSON.stringify(r.stores[1])).toBe(before);
    // the input is not mutated
    expect(JSON.stringify(b)).toContain('sk-secret');
  });

  it('returns the same bundle when there is no secret', () => {
    const b = bundle();
    expect(redactBackup(b)).toBe(b);
    const blank = bundle({
      stores: [{ name: 'bolid.settings', version: 3, state: { ai: { apiKey: '' } } }],
    });
    expect(redactBackup(blank)).toBe(blank);
  });
});

describe('validateBackup', () => {
  it('accepts a well-formed bundle', () => {
    const v = validateBackup(JSON.parse(serializeBackup(bundle())), KNOWN);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.warnings).toEqual([]);
      expect(v.bundle.stores).toHaveLength(2);
    }
  });

  it('rejects another format, non-array stores and a string version', () => {
    expect(validateBackup({ ...bundle(), format: 2 }, KNOWN)).toEqual({
      ok: false,
      reason: expect.stringMatching(/format 2/),
    });
    expect(validateBackup({ ...bundle(), stores: {} }, KNOWN).ok).toBe(false);
    expect(
      validateBackup(
        { ...bundle(), stores: [{ name: 'bolid.history', version: '2', state: {} }] },
        KNOWN,
      ).ok,
    ).toBe(false);
    expect(validateBackup('hello', KNOWN).ok).toBe(false);
    expect(validateBackup({ format: '1', stores: [] }, KNOWN).ok).toBe(false);
  });

  it('warns about an unknown store but keeps the rest', () => {
    const v = validateBackup(
      bundle({ stores: [...bundle().stores, { name: 'bolid.future', version: 1, state: {} }] }),
      KNOWN,
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.warnings).toEqual([expect.stringContaining('bolid.future')]);
      expect(v.bundle.stores).toHaveLength(3);
    }
  });

  it('drops an unsafe or malformed trip file with a warning', () => {
    const v = validateBackup(
      bundle({
        tripFiles: [
          { id: '1700', csv: 'x' },
          { id: '../settings', csv: 'evil' },
          { id: 'a/b', csv: 'evil' },
        ],
      }),
      KNOWN,
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.bundle.tripFiles).toEqual([{ id: '1700', csv: 'x' }]);
      expect(v.warnings).toEqual([expect.stringContaining('2 trip recording')]);
    }
  });

  it('keeps the first of two copies of a store', () => {
    const v = validateBackup(
      bundle({
        stores: [
          { name: 'bolid.scans', version: 1, state: { scans: [1] } },
          { name: 'bolid.scans', version: 1, state: { scans: [2] } },
        ],
      }),
      KNOWN,
    );
    expect(v.ok && v.bundle.stores).toEqual([
      { name: 'bolid.scans', version: 1, state: { scans: [1] } },
    ]);
  });

  it('parseBackup rejects text that is not JSON', () => {
    expect(parseBackup('PK\u0003\u0004zip', KNOWN).ok).toBe(false);
  });
});

describe('planRestore', () => {
  const current = { 'bolid.history': 2, 'bolid.scans': 1, 'bolid.trips': 1 };
  const migratable = new Set(['bolid.history', 'bolid.scans']);

  it('restores older and equal versions and skips a newer one', () => {
    const b = bundle({
      stores: [
        { name: 'bolid.history', version: 1, state: { entries: [] } },
        { name: 'bolid.scans', version: 5, state: { scans: [] } },
      ],
    });
    const plan = planRestore(b, ['bolid.history', 'bolid.scans'], current, migratable);
    expect(plan.restore.map((s) => s.name)).toEqual(['bolid.history']);
    expect(plan.skipped).toEqual([
      { name: 'bolid.scans', reason: expect.stringMatching(/newer app version.*5.*1/) },
    ]);
  });

  it('skips a selected store the backup lacks, or the app does not know', () => {
    const b = bundle({
      stores: [{ name: 'bolid.future', version: 1, state: {} }],
    });
    const plan = planRestore(b, ['bolid.trips', 'bolid.future'], current, migratable);
    expect(plan.restore).toEqual([]);
    expect(plan.skipped.map((s) => s.name)).toEqual(['bolid.trips', 'bolid.future']);
  });

  it('only restores what was selected', () => {
    const plan = planRestore(bundle(), ['bolid.scans'], current, migratable);
    expect(plan.restore.map((s) => s.name)).toEqual(['bolid.scans']);
    expect(plan.skipped).toEqual([]);
  });

  it('skips an older version of a store that has no migrate (zustand would wipe it)', () => {
    const b = bundle({
      stores: [
        { name: 'bolid.trips', version: 0, state: { trips: [] } },
        { name: 'bolid.history', version: 1, state: { entries: [] } },
      ],
    });
    const plan = planRestore(b, ['bolid.trips', 'bolid.history'], current, migratable);
    expect(plan.restore.map((s) => s.name)).toEqual(['bolid.history']);
    expect(plan.skipped).toEqual([
      {
        name: 'bolid.trips',
        reason: expect.stringMatching(/older data version \(0\).*cannot upgrade/),
      },
    ]);
  });
});

describe('file names and sizes', () => {
  it('backupFileName is UTC and sorts chronologically', () => {
    const a = backupFileName(Date.UTC(2026, 0, 9, 8, 5));
    const b = backupFileName(Date.UTC(2026, 10, 9, 14, 30));
    expect(a).toBe('bolid-backup-20260109-0805.json');
    expect(b).toBe('bolid-backup-20261109-1430.json');
    expect([b, a].sort()).toEqual([a, b]);
    expect(preRestoreFileName(Date.UTC(2026, 10, 9, 14, 30))).toBe(
      'pre-restore-20261109-1430.json',
    );
  });

  it('utf8Bytes counts multi-byte characters', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('°')).toBe(2);
    expect(utf8Bytes('—')).toBe(3);
    expect(utf8Bytes('🚗')).toBe(4);
  });

  it('estimateBundleBytes is the size of the written file', () => {
    const b = bundle();
    expect(estimateBundleBytes(b)).toBe(serializeBackup(b).length);
  });

  it('formatBytes uses metric units', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(340_000)).toBe('340 kB');
    expect(formatBytes(8_400_000)).toBe('8.4 MB');
  });

  it('countItems reads the first array, then the first record', () => {
    expect(countItems({ entries: [1, 2, 3] })).toBe(3);
    expect(countItems({ byProfile: { a: {}, b: {} } })).toBe(2);
    expect(countItems({ theme: 'dark' })).toBeNull();
    expect(countItems(null)).toBeNull();
  });
});

describe('pre-restore snapshots', () => {
  it('keeps the newest three, a same-minute suffix counting as newer', () => {
    const names = [
      'pre-restore-20261101-0900.json',
      'pre-restore-20261109-1430.json',
      'pre-restore-20261109-1430-2.json',
      'pre-restore-20261105-1200.json',
      'bolid-backup-20261101-0800.json',
      'notes.txt',
    ];
    expect(preRestoreFilesToDelete(names, 3)).toEqual(['pre-restore-20261101-0900.json']);
    expect(preRestoreFilesToDelete(names, 1).sort()).toEqual([
      'pre-restore-20261101-0900.json',
      'pre-restore-20261105-1200.json',
      'pre-restore-20261109-1430.json',
    ]);
  });

  it('uniqueFileName adds a suffix instead of overwriting', () => {
    const name = 'pre-restore-20261109-1430.json';
    expect(uniqueFileName(name, [])).toBe(name);
    expect(uniqueFileName(name, [name])).toBe('pre-restore-20261109-1430-2.json');
    expect(uniqueFileName(name, [name, 'pre-restore-20261109-1430-2.json'])).toBe(
      'pre-restore-20261109-1430-3.json',
    );
  });

  it('redactState blanks a key in a single store export', () => {
    expect(redactState({ ai: { apiKey: 'k' } })).toEqual({ ai: { apiKey: '' } });
  });
});
