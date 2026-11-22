/** The persisted-store registry is complete, and the four stores plan 18 touched persist with an
 *  explicit version: `bolid.scans` / `bolid.carBackups` (shipped unversioned, now v1 with a
 *  migration from 0) and `bolid.alerts` / `bolid.notifications` (were in memory only). */
jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, string>();
  return {
    __files: files,
    documentDirectory: 'file:///docs/',
    cacheDirectory: 'file:///cache/',
    getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
    readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
    writeAsStringAsync: jest.fn(async (uri: string, v: string) => {
      files.set(uri, v);
    }),
    deleteAsync: jest.fn(async (uri: string) => {
      files.delete(uri);
    }),
  };
});

import * as fs from 'fs';
import * as path from 'path';
import * as legacyFs from 'expo-file-system/legacy';
import { flushPendingWrites } from '@/shared/state/persistStorage';
import { useScanHistoryStore, migrateScans } from '@/features/module-scan/model/scanHistoryStore';
import { useCarBackupStore, migrateCarBackups } from '@/features/coding/model/carBackupStore';
import {
  useAlertsStore,
  sanitizeAlertRules,
  sanitizeSeededIds,
} from '@/features/alerts/model/alertsStore';
import { defaultRules } from '@/shared/obd-core';
import {
  useNotificationsStore,
  mergeNotifPrefs,
  DEFAULT_NOTIF_PREFS,
} from '@/features/notifications/model/notificationsStore';
import { STORE_NAMES, PERSISTED_STORES, NOT_BACKED_UP } from './registry';

const files = (legacyFs as unknown as { __files: Map<string, string> }).__files;
const fileOf = (name: string) => `file:///docs/${name}.json`;
const read = (name: string) => JSON.parse(files.get(fileOf(name)) ?? 'null');

beforeEach(() => files.clear());

describe('persisted-store registry', () => {
  /** Every `name: 'bolid.…'` in a file that calls `persist(` under src/ (tests excluded). */
  function persistedNamesInSource(): string[] {
    const root = path.resolve(__dirname, '../../..');
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const text = fs.readFileSync(p, 'utf8');
          if (!text.includes('persist(')) continue;
          for (const m of text.matchAll(/name:\s*'(bolid\.[A-Za-z0-9._-]+)'/g)) out.push(m[1]);
        }
      }
    };
    walk(root);
    return [...new Set(out)].sort();
  }

  it('lists every persisted store except the backup list and the seed/key plugin index', () => {
    const inSource = persistedNamesInSource();
    expect(inSource).toEqual(
      expect.arrayContaining(['bolid.history', 'bolid.settings', 'bolid.seedKeys']),
    );
    expect([...NOT_BACKED_UP]).toEqual(['bolid.backups', 'bolid.seedKeys']);
    expect([...STORE_NAMES].sort()).toEqual(
      inSource.filter((n) => !(NOT_BACKED_UP as readonly string[]).includes(n)),
    );
  });

  it('has a unique name and an explicit version for every store', () => {
    expect(new Set(STORE_NAMES).size).toBe(STORE_NAMES.length);
    for (const s of PERSISTED_STORES) expect(s.version()).toBeGreaterThanOrEqual(1);
  });

  it('offers CSV for history, scans and maintenance', () => {
    expect(PERSISTED_STORES.filter((s) => s.csv).map((s) => s.name)).toEqual([
      'bolid.history',
      'bolid.maintenance',
      'bolid.scans',
    ]);
  });

  it('leaves the error log and dismissed hints out of a restore by default', () => {
    expect(PERSISTED_STORES.filter((s) => !s.restoreByDefault).map((s) => s.name)).toEqual([
      'bolid.onboarding',
      'bolid.errors',
    ]);
  });
});

describe('bolid.scans / bolid.carBackups: v0 → v1', () => {
  // zustand wrote `version: 0` for a store declared without a version.
  it('keeps the scans of a version-0 file and rewrites it as v1', async () => {
    files.set(
      fileOf('bolid.scans'),
      JSON.stringify({ state: { scans: [{ id: 's1', ts: 1, modules: [] }] }, version: 0 }),
    );
    await useScanHistoryStore.persist.rehydrate();
    expect(useScanHistoryStore.getState().scans.map((s) => s.id)).toEqual(['s1']);
    await flushPendingWrites();
    expect(read('bolid.scans')).toMatchObject({ version: 1, state: { scans: [{ id: 's1' }] } });
  });

  it('keeps the snapshots of a version-0 file and rewrites it as v1', async () => {
    files.set(
      fileOf('bolid.carBackups'),
      JSON.stringify({ state: { backups: [{ id: 'b1' }] }, version: 0 }),
    );
    await useCarBackupStore.persist.rehydrate();
    expect(useCarBackupStore.getState().backups.map((b) => b.id)).toEqual(['b1']);
    await flushPendingWrites();
    expect(read('bolid.carBackups')).toMatchObject({ version: 1 });
  });

  it('turns a malformed list into an empty one', () => {
    expect(migrateScans({ scans: 'x' }, 0)).toEqual({ scans: [] });
    expect(migrateScans(null, 0)).toEqual({ scans: [] });
    expect(migrateCarBackups({}, 0)).toEqual({ backups: [] });
  });
});

describe('bolid.alerts', () => {
  const rule = {
    id: 'r1',
    pid: '0105',
    op: 'gt' as const,
    value: 105,
    severity: 'critical' as const,
  };

  it('writes the rules (not the active alerts) as v1', () => {
    useAlertsStore.getState().setRules([rule]);
    useAlertsStore.getState().setActive([{ id: 'r1' } as never]);
    expect(read('bolid.alerts')).toEqual({ state: { rules: [rule], seededIds: [] }, version: 1 });
  });

  it('rehydrates the stored rules over the in-memory ones', async () => {
    useAlertsStore.setState({ rules: [] }); // (writes the file, so it goes first)
    files.set(fileOf('bolid.alerts'), JSON.stringify({ state: { rules: [rule] }, version: 1 }));
    await useAlertsStore.persist.rehydrate();
    expect(useAlertsStore.getState().rules).toEqual([rule]);
  });

  describe('starter rules', () => {
    beforeEach(() => useAlertsStore.setState({ rules: [], seededIds: [] }));
    const ids = () => useAlertsStore.getState().rules.map((r) => r.id);

    it('adds the ones the car supports, and a later car adds the ones the first lacked', () => {
      useAlertsStore.getState().seedDefaults(['0105', '010C']);
      expect(ids()).toEqual(['coolant-hot', 'over-rev']);
      useAlertsStore.getState().seedDefaults(['0105', '0142', '010C']);
      expect(ids()).toEqual(['coolant-hot', 'over-rev', 'low-voltage']);
      expect(read('bolid.alerts').state.seededIds).toEqual([
        'coolant-hot',
        'over-rev',
        'low-voltage',
      ]);
    });

    it('never re-adds a deleted starter rule, and an emptied list stays empty after a restart', async () => {
      useAlertsStore.getState().seedDefaults(['0105', '0142']);
      useAlertsStore.getState().removeRule('coolant-hot');
      useAlertsStore.getState().removeRule('low-voltage');
      useAlertsStore.getState().seedDefaults(['0105', '0142']);
      expect(ids()).toEqual([]);
      // a fresh launch: memory back to the initial state, then the file is read
      const file = files.get(fileOf('bolid.alerts'))!;
      useAlertsStore.setState({ rules: [], seededIds: [] });
      files.set(fileOf('bolid.alerts'), file);
      await useAlertsStore.persist.rehydrate();
      useAlertsStore.getState().seedDefaults(['0105', '0142']);
      expect(ids()).toEqual([]);
    });

    it('keeps a starter rule seeded during the hydration window unless the file offered it', async () => {
      useAlertsStore.setState({
        rules: defaultRules(['0105', '0142']),
        seededIds: ['coolant-hot', 'low-voltage'],
      }); // (writes the file, so it goes first)
      files.set(
        fileOf('bolid.alerts'),
        JSON.stringify({ state: { rules: [rule], seededIds: ['coolant-hot'] }, version: 1 }),
      );
      await useAlertsStore.persist.rehydrate();
      expect(ids()).toEqual(['r1', 'low-voltage']);
      expect(useAlertsStore.getState().seededIds).toEqual(['coolant-hot', 'low-voltage']);
    });

    it('treats a file without seededIds that holds rules as already seeded', () => {
      expect(sanitizeSeededIds({ rules: [rule] }, [rule])).toEqual([
        'coolant-hot',
        'low-voltage',
        'over-rev',
      ]);
      expect(sanitizeSeededIds({ rules: [] }, [])).toEqual([]);
    });
  });

  it('drops malformed rules', () => {
    expect(sanitizeAlertRules({ rules: [rule, { id: 'x' }, null] })).toEqual([rule]);
    expect(sanitizeAlertRules(undefined)).toEqual([]);
  });
});

describe('bolid.notifications', () => {
  it('writes prefs and reminders (not the OS permission) as v1', () => {
    useNotificationsStore.getState().setPermission('granted');
    useNotificationsStore.getState().toggleCategory('trip');
    const blob = read('bolid.notifications');
    expect(blob.version).toBe(1);
    expect(blob.state.prefs.categories.trip).toBe(false);
    expect(blob.state).not.toHaveProperty('permission');
  });

  it('rehydrates the stored prefs, filling categories the file predates', async () => {
    useNotificationsStore.setState({ permission: 'denied' }); // (writes the file, so it goes first)
    files.set(
      fileOf('bolid.notifications'),
      JSON.stringify({
        state: {
          prefs: { categories: { alert: false }, muted: true },
          reminders: [{ id: 'm1', title: 'Oil' }],
        },
        version: 1,
      }),
    );
    await useNotificationsStore.persist.rehydrate();
    const s = useNotificationsStore.getState();
    expect(s.prefs).toEqual({
      categories: { ...DEFAULT_NOTIF_PREFS.categories, alert: false },
      muted: true,
    });
    expect(s.reminders).toEqual([{ id: 'm1', title: 'Oil' }]);
    expect(s.permission).toBe('denied');
  });

  it('mergeNotifPrefs ignores wrong types', () => {
    expect(mergeNotifPrefs({ categories: { trip: 'no' }, muted: 1 })).toEqual(DEFAULT_NOTIF_PREFS);
  });
});
