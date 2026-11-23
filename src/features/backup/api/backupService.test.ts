/** Backup → clear → restore end to end against the real stores (plan 18), over an in-memory
 *  file system that serves both `fileStateStorage` (the persisted stores) and the backup's own
 *  file I/O. The native share sheet and picker are fakes. */
jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, string>();
  return {
    __files: files,
    documentDirectory: 'file:///docs/',
    cacheDirectory: 'file:///cache/',
    getInfoAsync: jest.fn(async (uri: string) => ({
      exists: files.has(uri),
      size: files.get(uri)?.length,
    })),
    readAsStringAsync: jest.fn(async (uri: string) => {
      const v = files.get(uri);
      if (v === undefined) throw new Error(`ENOENT ${uri}`);
      return v;
    }),
    writeAsStringAsync: jest.fn(async (uri: string, v: string) => {
      files.set(uri, v);
    }),
    deleteAsync: jest.fn(async (uri: string) => {
      files.delete(uri);
    }),
    makeDirectoryAsync: jest.fn(async () => undefined),
    readDirectoryAsync: jest.fn(async (dir: string) =>
      [...files.keys()]
        .filter((k) => k.startsWith(dir) && !k.slice(dir.length).includes('/'))
        .map((k) => k.slice(dir.length)),
    ),
  };
});

import * as legacyFs from 'expo-file-system/legacy';
import type { StoreApi, UseBoundStore } from 'zustand';
import { setSecureStoreModule } from '@/shared/state/secureApiKey';
import { flushPendingWrites } from '@/shared/state/persistStorage';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';
import { useTripStore, type TripSummary } from '@/features/trip-recording/model/tripStore';
import { useScanHistoryStore, type SavedScan } from '@/features/module-scan/model/scanHistoryStore';
import { useCarBackupStore } from '@/features/coding/model/carBackupStore';
import { useDashboardLayoutStore } from '@/features/live-data/model/dashboardLayoutStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import { useAlertsStore } from '@/features/alerts/model/alertsStore';
import { useNotificationsStore } from '@/features/notifications/model/notificationsStore';
import { useLoginBookStore } from '@/features/adaptations/model/loginBookStore';
import { parseBackup, type BackupBundle } from '@/shared/lib/backup';
import { MAX_BACKUP_RECORDS, useBackupStore } from '../model/backupStore';
import { STORE_NAMES, PERSISTED_STORES } from './registry';
import {
  backupFileUri,
  createBackup,
  exportStore,
  pickBackupFile,
  readListedBackup,
  restoreBackup,
  shareBackupFile,
  storesEstimateBytes,
  tripFilesSummary,
  type BackupModules,
} from './backupService';

const files = (legacyFs as unknown as { __files: Map<string, string> }).__files;
const DOC = 'file:///docs/';
const T = Date.UTC(2026, 10, 9, 14, 30);
const GOLF = 'golf-plus-2009-20tdi';
const VEHICLE = { id: GOLF, label: 'VW Golf Plus', vin: 'WVWZZZ1KZ9W903398' };

const sharing = {
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
};
const picker = { getDocumentAsync: jest.fn() };

function mods(over: Partial<BackupModules> = {}): BackupModules {
  return {
    FileSystem: legacyFs as unknown as BackupModules['FileSystem'],
    Sharing: sharing,
    Picker: picker,
    ...over,
  };
}

type AnyStore = UseBoundStore<StoreApi<any>> & { persist: { clearStorage: () => void } };
const STORES: AnyStore[] = [
  useSettingsStore,
  useHistoryStore,
  useVehicleStore,
  useGarageStore,
  useErrorLogStore,
  useMaintenanceStore,
  useTripStore,
  useScanHistoryStore,
  useCarBackupStore,
  useDashboardLayoutStore,
  useOnboardingStore,
  useAlertsStore,
  useNotificationsStore,
  useLoginBookStore,
  useLabelPackStore,
  useBackupStore,
];
const INITIAL = STORES.map((s) => ({ s, state: s.getState() }));

/** Every store back to its first state, every file gone — "a cleared app". */
function clearApp(): void {
  for (const { s, state } of INITIAL) {
    s.setState(state, true);
    s.persist.clearStorage();
  }
  files.clear();
}

const keychain = new Map<string, string>();

const trip: TripSummary = {
  header: {
    id: '1762698600000',
    startedAt: T - 600_000,
    endedAt: T,
    profileId: GOLF,
    vin: VEHICLE.vin,
    protocol: '6',
  },
  stats: { durationMs: 600_000, sampleCount: 2 } as TripSummary['stats'],
  markerCount: 0,
  vehicleId: GOLF,
};
const TRIP_CSV = 'ts,010C\n1762698000000,800\n1762698001000,850\n';

const scan: SavedScan = {
  id: 'scan-1',
  ts: T,
  vehicle: VEHICLE,
  protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
  modules: [
    {
      address: '01',
      name: 'Engine',
      state: 'ok',
      dtcs: [
        {
          sae: 'P2183',
          display: 'P2183 00',
          vagCode: '08579',
          description: 'Coolant temp sensor 2',
          status: 9,
        },
      ],
    },
  ],
  tp20: null,
};

/** Populate every store like the plan's simulator walk-through. */
function populate(): void {
  useSettingsStore.getState().setTheme('light');
  useSettingsStore.getState().setPollInterval(500);
  useSettingsStore.getState().setAi({ apiKey: 'sk-test-secret-123' });
  useVehicleStore.getState().select(GOLF);
  useGarageStore
    .getState()
    .add({ name: 'Dacia Logan 2015', fuel: 'diesel', baseProfileId: 'generic' } as never);
  useHistoryStore.getState().addDtcCheck({
    ts: T,
    vehicle: VEHICLE,
    milOn: true,
    stored: [{ code: 'P0299', description: 'Turbo underboost' }],
    pending: [],
    permanent: [],
    monitorsComplete: 5,
    monitorsTotal: 7,
  });
  useScanHistoryStore.getState().saveScan(scan);
  useTripStore.getState().finish(trip);
  files.set(`${DOC}trip-${trip.header.id}.csv`, TRIP_CSV);
  useMaintenanceStore
    .getState()
    .addEntry([`id:${GOLF}`], { itemId: 'engine-oil', date: T, odoKm: 182_000, note: '5W-30' });
  useCarBackupStore.getState().save({
    id: 'cb-1',
    ts: T,
    vehicle: VEHICLE,
    protocol: 'CAN',
    modules: [],
  });
  useDashboardLayoutStore.getState().setOrder(GOLF, ['010D', '010C']);
  useOnboardingStore.getState().dismiss('live-hint');
  useAlertsStore.getState().addRule({
    id: 'r1',
    pid: '0105',
    op: 'gt',
    value: 105,
    severity: 'critical',
    label: 'Coolant hot',
  });
  useNotificationsStore.getState().toggleCategory('trip');
  useLoginBookStore.getState().remember('id:passat-b55-19tdi', {
    address: '01',
    code: 4242,
    purpose: 'Idle speed adaptation',
    source: 'user-entered',
  });
  useLabelPackStore.getState().add({
    id: 'imported-edc17',
    module: 'EDC17 (imported)',
    partNumberPrefixes: ['03L906022'],
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function backupText(): string {
  const key = [...files.keys()].find((k) => k.includes('/backups/bolid-backup-'));
  if (!key) throw new Error('no backup written');
  return files.get(key)!;
}

beforeEach(async () => {
  keychain.clear();
  setSecureStoreModule({
    getItemAsync: async (k) => keychain.get(k) ?? null,
    setItemAsync: async (k, v) => {
      keychain.set(k, v);
    },
    deleteItemAsync: async (k) => {
      keychain.delete(k);
    },
  });
  clearApp();
  await settle();
  sharing.shareAsync.mockClear();
  picker.getDocumentAsync.mockReset();
});

describe('createBackup', () => {
  it('writes format 1 with every store and the trip files, and no API key', async () => {
    populate();
    const created = await createBackup(mods(), {
      includeTrips: true,
      share: true,
      now: T,
      platform: 'android',
    });
    expect(created).not.toBeNull();
    expect(created!.record.fileName).toBe('bolid-backup-20261109-1430.json');
    const uri = backupFileUri(mods(), created!.record.fileName);
    expect(uri).toBe(`${DOC}backups/bolid-backup-20261109-1430.json`);
    expect(created!.record).not.toHaveProperty('uri');
    expect(sharing.shareAsync).toHaveBeenCalledWith(uri, expect.anything());

    const text = backupText();
    expect(text).not.toContain('sk-test-secret-123');
    const parsed = JSON.parse(text) as BackupBundle;
    expect(parsed.format).toBe(1);
    expect(parsed.app.platform).toBe('android');
    const names = parsed.stores.map((s) => s.name);
    // the error log only has a file once something was logged; everything populated is there
    for (const n of STORE_NAMES.filter((x) => x !== 'bolid.errors')) expect(names).toContain(n);
    expect(names).not.toContain('bolid.backups');
    expect(parsed.tripFiles).toEqual([{ id: trip.header.id, csv: TRIP_CSV }]);
    const apiKeys = text.match(/"apiKey": "[^"]*"/g) ?? [];
    expect(apiKeys.every((m) => m === '"apiKey": ""')).toBe(true);
    // recorded in the backup list
    expect(useBackupStore.getState().records[0]).toMatchObject({
      kind: 'backup',
      includesTrips: true,
    });
  });

  it('leaves trip files out when asked', async () => {
    populate();
    await createBackup(mods(), { includeTrips: false, now: T });
    expect('tripFiles' in JSON.parse(backupText())).toBe(false);
  });

  it('two backups in the same minute do not overwrite each other', async () => {
    populate();
    const a = await createBackup(mods(), { includeTrips: false, now: T });
    const b = await createBackup(mods(), { includeTrips: false, now: T + 10_000 });
    expect(a!.record.fileName).not.toBe(b!.record.fileName);
    expect(
      files.has(backupFileUri(mods(), a!.record.fileName)) &&
        files.has(backupFileUri(mods(), b!.record.fileName)),
    ).toBe(true);
  });

  it('deletes the file of a backup that drops off the list', async () => {
    populate();
    const first = await createBackup(mods(), { includeTrips: false, now: T });
    for (let i = 1; i <= MAX_BACKUP_RECORDS; i++) {
      await createBackup(mods(), { includeTrips: false, now: T + i * 3_600_000 });
    }
    const listed = useBackupStore.getState().records.map((r) => r.fileName);
    expect(listed).toHaveLength(MAX_BACKUP_RECORDS);
    expect(listed).not.toContain(first!.record.fileName);
    expect(files.has(backupFileUri(mods(), first!.record.fileName))).toBe(false);
    const onDisk = [...files.keys()].filter((k) => k.includes('/backups/bolid-backup-'));
    expect(onDisk).toHaveLength(MAX_BACKUP_RECORDS);
  });

  it('a pre-restore snapshot never pushes a backup the user made off the list', async () => {
    populate();
    const made: string[] = [];
    for (let i = 0; i < MAX_BACKUP_RECORDS; i++) {
      const b = await createBackup(mods(), { includeTrips: false, now: T + i * 3_600_000 });
      made.push(b!.record.fileName);
    }
    const oldest = made[0];
    const v = await readListedBackup(
      mods(),
      useBackupStore.getState().records.find((r) => r.fileName === oldest)!,
    );
    if (!v.ok) throw new Error(v.reason);
    const res = await restoreBackup(mods(), v.bundle, {
      stores: ['bolid.onboarding'],
      includeTrips: false,
      now: T + 30 * 3_600_000,
    });
    expect(res.ok).toBe(true);
    const records = useBackupStore.getState().records;
    expect(records.filter((r) => r.kind === 'backup').map((r) => r.fileName)).toEqual(
      [...made].reverse(),
    );
    expect(records.filter((r) => r.kind === 'pre-restore')).toHaveLength(1);
    expect(files.has(backupFileUri(mods(), oldest))).toBe(true);
  });

  it('finds a listed file by its name after the document directory moved (iOS update)', async () => {
    populate();
    const created = await createBackup(mods(), { includeTrips: false, now: T });
    const text = files.get(backupFileUri(mods(), created!.record.fileName))!;
    const moved = mods({
      FileSystem: {
        ...(legacyFs as unknown as BackupModules['FileSystem']),
        documentDirectory: 'file:///new-container/',
      },
    });
    files.set(`file:///new-container/backups/${created!.record.fileName}`, text);
    expect((await readListedBackup(moved, created!.record)).ok).toBe(true);
    expect(await shareBackupFile(moved, created!.record)).toBe(true);
    expect(sharing.shareAsync).toHaveBeenLastCalledWith(
      `file:///new-container/backups/${created!.record.fileName}`,
      expect.anything(),
    );
  });

  it('drops a stored absolute uri from an older list file', async () => {
    files.set(
      `${DOC}bolid.backups.json`,
      JSON.stringify({
        state: {
          records: [
            {
              fileName: 'bolid-backup-20261101-0900.json',
              uri: 'file:///old-container/backups/bolid-backup-20261101-0900.json',
              createdAt: T,
              bytes: 10,
              kind: 'backup',
              includesTrips: false,
            },
          ],
        },
        version: 1,
      }),
    );
    await useBackupStore.persist.rehydrate();
    const [r] = useBackupStore.getState().records;
    expect(r.fileName).toBe('bolid-backup-20261101-0900.json');
    expect(r).not.toHaveProperty('uri');
  });

  it('estimates the store part of the bundle as it is written', async () => {
    populate();
    const estimate = await storesEstimateBytes();
    await createBackup(mods(), { includeTrips: false, now: T });
    const written = Buffer.byteLength(backupText(), 'utf8');
    expect(Math.abs(estimate - written)).toBeLessThan(200);
  });

  it('counts the trip recordings for the toggle', async () => {
    populate();
    expect(await tripFilesSummary(mods())).toEqual({ count: 1, bytes: TRIP_CSV.length });
  });
});

describe('restoreBackup', () => {
  async function backupThenClear(): Promise<BackupBundle> {
    populate();
    const created = await createBackup(mods(), { includeTrips: true, now: T });
    const v = await readListedBackup(mods(), created!.record);
    if (!v.ok) throw new Error(v.reason);
    const text = files.get(backupFileUri(mods(), created!.record.fileName))!;
    clearApp();
    await settle();
    files.set(`${DOC}backups/kept.json`, text); // the user's copy survives the "reinstall"
    return v.bundle;
  }

  it('restores every store onto a cleared app, with the trip samples and a pre-restore snapshot', async () => {
    const bundle = await backupThenClear();
    expect(useHistoryStore.getState().entries).toHaveLength(0);

    const res = await restoreBackup(mods(), bundle, {
      stores: STORE_NAMES,
      includeTrips: true,
      now: T + 60_000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.skipped.filter((s) => s.name !== 'bolid.errors')).toEqual([]);
    expect(res.tripFilesWritten).toBe(1);

    expect(useSettingsStore.getState().theme).toBe('light');
    expect(useSettingsStore.getState().pollIntervalMs).toBe(500);
    expect(useVehicleStore.getState().selectedProfileId).toBe(GOLF);
    expect(useGarageStore.getState().vehicles.map((v) => v.name)).toEqual(['Dacia Logan 2015']);
    expect(useHistoryStore.getState().entries[0]).toMatchObject({ kind: 'dtc', vehicle: VEHICLE });
    expect(useScanHistoryStore.getState().scans.map((s) => s.id)).toEqual(['scan-1']);
    expect(useTripStore.getState().trips.map((t) => t.header.id)).toEqual([trip.header.id]);
    expect(files.get(`${DOC}trip-${trip.header.id}.csv`)).toBe(TRIP_CSV);
    expect(useMaintenanceStore.getState().byVehicle[`id:${GOLF}`].entries[0]).toMatchObject({
      itemId: 'engine-oil',
      odoKm: 182_000,
    });
    expect(useCarBackupStore.getState().backups.map((b) => b.id)).toEqual(['cb-1']);
    expect(useDashboardLayoutStore.getState().byProfile[GOLF].order).toEqual(['010D', '010C']);
    expect(useOnboardingStore.getState().dismissed).toEqual(['live-hint']);
    expect(useAlertsStore.getState().rules.map((r) => r.id)).toEqual(['r1']);
    expect(useNotificationsStore.getState().prefs.categories.trip).toBe(false);
    expect(useLoginBookStore.getState().byVehicle['id:passat-b55-19tdi']).toEqual([
      { address: '01', code: 4242, purpose: 'Idle speed adaptation', source: 'user-entered' },
    ]);
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual(['imported-edc17']);

    // the snapshot of the (empty) data before the restore
    expect(res.snapshot.kind).toBe('pre-restore');
    expect(res.snapshot.fileName).toBe('pre-restore-20261109-1431.json');
    expect(files.has(`${DOC}backups/pre-restore-20261109-1431.json`)).toBe(true);
    // the store files themselves now hold the restored data
    expect(JSON.parse(files.get(`${DOC}bolid.scans.json`)!).state.scans).toHaveLength(1);
  });

  it('replaces the current data instead of merging with it', async () => {
    const bundle = await backupThenClear();
    useHistoryStore.getState().addDtcCheck({
      vehicle: { id: 'generic', label: 'Other car', vin: null },
      milOn: false,
      stored: [],
      pending: [],
      permanent: [],
      monitorsComplete: null,
      monitorsTotal: null,
    });
    await restoreBackup(mods(), bundle, { stores: ['bolid.history'], includeTrips: false });
    const entries = useHistoryStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].vehicle.label).toBe('VW Golf Plus');
  });

  it('migrates an older store version through its own migrate (history v1 → v3)', async () => {
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '0.1.0', platform: 'android' },
      stores: [
        {
          name: 'bolid.history',
          version: 1,
          state: {
            entries: [
              {
                kind: 'dtc',
                id: 'old-1',
                ts: T,
                vehicleLabel: 'Fiat Punto',
                milOn: false,
                stored: [],
                pending: [],
                permanent: [],
                monitorsComplete: null,
                monitorsTotal: null,
              },
            ],
          },
        },
      ],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    const res = await restoreBackup(mods(), bundle, {
      stores: ['bolid.history'],
      includeTrips: false,
    });
    expect(res.ok && res.restored).toEqual(['bolid.history']);
    expect(useHistoryStore.getState().entries[0].vehicle).toEqual({
      id: 'unknown',
      label: 'Fiat Punto',
      vin: null,
    });
    // the migrated state was written back at the current version
    await settle();
    await import('@/shared/state/persistStorage').then((m) => m.flushPendingWrites());
    expect(JSON.parse(files.get(`${DOC}bolid.history.json`)!).version).toBe(3);
  });

  it('restores a history v2 backup from before plan 34d: every entry survives, written as v3', async () => {
    const vehicle = { id: 'golf-plus-2009-20tdi', label: 'VW Golf Plus', vin: null };
    const report = {
      overall: 'ok',
      summary: 'All good.',
      findings: [],
      actions: [],
      source: 'local',
      disclaimer: 'd',
    };
    const oldAi = {
      kind: 'ai',
      id: 'old-ai',
      ts: T,
      vehicle,
      source: 'local',
      overall: 'ok',
      summary: 'All good.',
      findingCount: 0,
      report,
    };
    const oldDtc = {
      kind: 'dtc',
      id: 'old-dtc',
      ts: T - 1,
      vehicle,
      milOn: false,
      stored: [],
      pending: [],
      permanent: [],
      monitorsComplete: null,
      monitorsTotal: null,
    };
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '0.9.1', platform: 'android' },
      stores: [{ name: 'bolid.history', version: 2, state: { entries: [oldAi, oldDtc] } }],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    const res = await restoreBackup(mods(), bundle, {
      stores: ['bolid.history'],
      includeTrips: false,
    });
    expect(res.ok && res.restored).toEqual(['bolid.history']);
    expect(useHistoryStore.getState().entries).toEqual([oldAi, oldDtc]);
    await settle();
    await import('@/shared/state/persistStorage').then((m) => m.flushPendingWrites());
    const written = JSON.parse(files.get(`${DOC}bolid.history.json`)!);
    expect(written.version).toBe(3);
    expect(written.state.entries).toEqual([oldAi, oldDtc]);
  });

  it('restores an unversioned (v0) scans blob from before plan 18', async () => {
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '0.1.0', platform: 'android' },
      stores: [{ name: 'bolid.scans', version: 0, state: { scans: [scan] } }],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    await restoreBackup(mods(), bundle, { stores: ['bolid.scans'], includeTrips: false });
    expect(useScanHistoryStore.getState().scans.map((s) => s.id)).toEqual(['scan-1']);
  });

  it('skips a store saved by a newer app and restores the others', async () => {
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '9.0.0', platform: 'android' },
      stores: [
        { name: 'bolid.history', version: 99, state: { entries: [] } },
        { name: 'bolid.onboarding', version: 1, state: { dismissed: ['x'] } },
      ],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    useHistoryStore.getState().addDtcCheck({
      vehicle: VEHICLE,
      milOn: false,
      stored: [],
      pending: [],
      permanent: [],
      monitorsComplete: null,
      monitorsTotal: null,
    });
    const res = await restoreBackup(mods(), bundle, {
      stores: ['bolid.history', 'bolid.onboarding'],
      includeTrips: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restored).toEqual(['bolid.onboarding']);
    expect(res.skipped).toEqual([
      { name: 'bolid.history', reason: expect.stringContaining('newer app version') },
    ]);
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(useOnboardingStore.getState().dismissed).toEqual(['x']);
  });

  it('skips an older version of a store without a migrate instead of wiping it', async () => {
    useOnboardingStore.getState().dismiss('live-hint');
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '0.1.0', platform: 'android' },
      stores: [
        { name: 'bolid.onboarding', version: 0, state: { dismissed: ['x'] } },
        { name: 'bolid.scans', version: 0, state: { scans: [scan] } },
      ],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    const res = await restoreBackup(mods(), bundle, {
      stores: ['bolid.onboarding', 'bolid.scans'],
      includeTrips: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restored).toEqual(['bolid.scans']); // scans has a migrate
    expect(res.skipped).toEqual([
      { name: 'bolid.onboarding', reason: expect.stringContaining('cannot upgrade') },
    ]);
    expect(useOnboardingStore.getState().dismissed).toEqual(['live-hint']);
  });

  it('does not report a store as restored when its file could not be written', async () => {
    useOnboardingStore.getState().dismiss('live-hint');
    await settle();
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '0.9.0', platform: 'android' },
      stores: [
        { name: 'bolid.onboarding', version: 1, state: { dismissed: ['x'] } },
        { name: 'bolid.scans', version: 1, state: { scans: [scan] } },
      ],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    const fs = legacyFs as unknown as { writeAsStringAsync: jest.Mock };
    const real = fs.writeAsStringAsync.getMockImplementation()!;
    fs.writeAsStringAsync.mockImplementation(async (uri: string, v: string) => {
      if (uri === `${DOC}bolid.onboarding.json`) throw new Error('disk full');
      return real(uri, v);
    });
    try {
      const res = await restoreBackup(mods(), bundle, {
        stores: ['bolid.onboarding', 'bolid.scans'],
        includeTrips: false,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.restored).toEqual(['bolid.scans']);
      expect(res.skipped).toEqual([
        { name: 'bolid.onboarding', reason: expect.stringContaining('Could not be restored') },
      ]);
      expect(useOnboardingStore.getState().dismissed).toEqual(['live-hint']);
    } finally {
      fs.writeAsStringAsync.mockImplementation(real);
    }
  });

  it('skips a store whose own merge rejects the blob, and puts its previous file back', async () => {
    useTripStore.getState().finish(trip);
    await flushPendingWrites(); // the trips list writes debounced
    const before = files.get(`${DOC}bolid.trips.json`);
    expect(before).toBeDefined();
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '0.9.0', platform: 'android' },
      stores: [
        // passes validation, but tripStore's merge throws on `t.header.id`
        { name: 'bolid.trips', version: 1, state: { trips: [{}] } },
        { name: 'bolid.scans', version: 1, state: { scans: [scan] } },
      ],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    const res = await restoreBackup(mods(), bundle, {
      stores: ['bolid.trips', 'bolid.scans'],
      includeTrips: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restored).toEqual(['bolid.scans']);
    expect(res.skipped).toEqual([
      { name: 'bolid.trips', reason: expect.stringContaining('Could not be restored') },
    ]);
    expect(useTripStore.getState().trips.map((t) => t.header.id)).toEqual([trip.header.id]);
    expect(files.get(`${DOC}bolid.trips.json`)).toBe(before);
    // the store's own options are back: a later rehydrate of the good file works
    await useTripStore.persist.rehydrate();
    expect(useTripStore.getState().trips.map((t) => t.header.id)).toEqual([trip.header.id]);
  });

  it('deletes the CSVs of trips the restored list dropped', async () => {
    const bundle = await backupThenClear();
    const other: TripSummary = {
      ...trip,
      header: { ...trip.header, id: '1762690000000' },
    };
    useTripStore.getState().finish(other);
    files.set(`${DOC}trip-${other.header.id}.csv`, TRIP_CSV);
    const res = await restoreBackup(mods(), bundle, {
      stores: ['bolid.trips'],
      includeTrips: true,
    });
    expect(res.ok && res.restored).toEqual(['bolid.trips']);
    expect(useTripStore.getState().trips.map((t) => t.header.id)).toEqual([trip.header.id]);
    expect(files.has(`${DOC}trip-${other.header.id}.csv`)).toBe(false);
    expect(files.get(`${DOC}trip-${trip.header.id}.csv`)).toBe(TRIP_CSV);
    // the pre-restore snapshot still holds the dropped trip's recording (undo)
    const snap = [...files.entries()].find(([k]) => k.includes('/backups/pre-restore-'))![1];
    expect(snap).toContain(other.header.id);
  });

  it('writes no trip recording for a trip that is not in the trips list', async () => {
    const bundle = await backupThenClear();
    const res = await restoreBackup(mods(), bundle, {
      stores: ['bolid.onboarding'],
      includeTrips: true,
    });
    expect(res.ok && res.tripFilesWritten).toBe(0);
    expect(files.has(`${DOC}trip-${trip.header.id}.csv`)).toBe(false);
  });

  it('never restores an API key a hand-edited backup carries', async () => {
    const bundle: BackupBundle = {
      format: 1,
      createdAt: T,
      app: { version: '0.9.0', platform: 'android' },
      stores: [
        {
          name: 'bolid.settings',
          version: 3,
          state: { theme: 'system', ai: { provider: 'openai', apiKey: 'sk-planted' } },
        },
      ],
      sizes: { storesBytes: 0, tripBytes: 0 },
    };
    await restoreBackup(mods(), bundle, { stores: ['bolid.settings'], includeTrips: false });
    await settle();
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(useSettingsStore.getState().ai.apiKey).not.toBe('sk-planted');
    expect([...keychain.values()]).not.toContain('sk-planted');
    expect(files.get(`${DOC}bolid.settings.json`)).not.toContain('sk-planted');
  });

  it('keeps a trip that is being recorded', async () => {
    const bundle = await backupThenClear();
    useTripStore.getState().start();
    useTripStore.getState().pushSample({ t: 1, values: {} } as never);
    await restoreBackup(mods(), bundle, { stores: ['bolid.trips'], includeTrips: false });
    expect(useTripStore.getState().recording).toBe(true);
    expect(useTripStore.getState().samples).toHaveLength(1);
    expect(useTripStore.getState().trips).toHaveLength(1);
  });

  it('keeps only the newest three pre-restore snapshots', async () => {
    const bundle = await backupThenClear();
    for (let i = 0; i < 5; i++) {
      await restoreBackup(mods(), bundle, {
        stores: ['bolid.onboarding'],
        includeTrips: false,
        now: T + (i + 1) * 3_600_000,
      });
    }
    const snaps = [...files.keys()].filter((k) => k.includes('/backups/pre-restore-'));
    expect(snaps).toHaveLength(3);
    expect(useBackupStore.getState().records.filter((r) => r.kind === 'pre-restore')).toHaveLength(
      3,
    );
  });

  it('restores nothing when the snapshot cannot be written', async () => {
    const bundle = await backupThenClear();
    const fs = legacyFs as unknown as { writeAsStringAsync: jest.Mock };
    fs.writeAsStringAsync.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await restoreBackup(mods(), bundle, { stores: STORE_NAMES, includeTrips: true });
    quiet.mockRestore();
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('nothing was restored') });
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });
});

describe('exportStore', () => {
  it('shares a JSON file for every registry row, without the API key', async () => {
    populate();
    for (const ref of PERSISTED_STORES) {
      const uri = await exportStore(mods(), ref.name, 'json', T);
      expect(uri).toBe(`${DOC}bolid-${ref.name.replace('bolid.', '')}-20261109-1430.json`);
      const body = JSON.parse(files.get(uri!)!);
      expect(body).toMatchObject({ name: ref.name, version: ref.version() });
    }
    expect(files.get(`${DOC}bolid-settings-20261109-1430.json`)).not.toContain('sk-test');
    expect(sharing.shareAsync).toHaveBeenCalledTimes(PERSISTED_STORES.length);
  });

  it('writes CSV for history, scans and maintenance only', async () => {
    populate();
    const history = await exportStore(mods(), 'bolid.history', 'csv', T);
    expect(files.get(history!)).toContain('P0299');
    const scans = await exportStore(mods(), 'bolid.scans', 'csv', T);
    expect(files.get(scans!)).toContain('08579');
    const maint = await exportStore(mods(), 'bolid.maintenance', 'csv', T);
    expect(files.get(maint!)).toContain('182000');
    expect(await exportStore(mods(), 'bolid.settings', 'csv', T)).toBeNull();
    expect(await exportStore(mods(), 'bolid.nope', 'json', T)).toBeNull();
  });
});

describe('pickBackupFile', () => {
  it('validates the picked file', async () => {
    populate();
    const created = await createBackup(mods(), { includeTrips: true, now: T });
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: backupFileUri(mods(), created!.record.fileName), name: 'my-backup.json' }],
    });
    const res = await pickBackupFile(mods());
    expect(res.status).toBe('picked');
    if (res.status === 'picked') {
      expect(res.name).toBe('my-backup.json');
      expect(res.validation.ok).toBe(true);
    }
  });

  it('reports a file that is not a backup, a cancel, and a build without the picker', async () => {
    files.set('file:///cache/photo.json', '{"hello":1}');
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/photo.json', name: 'photo.json' }],
    });
    const bad = await pickBackupFile(mods());
    expect(bad.status === 'picked' && bad.validation.ok).toBe(false);
    picker.getDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await pickBackupFile(mods())).toEqual({ status: 'cancelled' });
    expect(await pickBackupFile(mods({ Picker: null }))).toEqual({ status: 'unavailable' });
  });

  it('parseBackup of a written backup has no warnings', async () => {
    populate();
    await createBackup(mods(), { includeTrips: true, now: T });
    const v = parseBackup(backupText(), STORE_NAMES);
    expect(v.ok && v.warnings).toEqual([]);
  });
});
