/** Settings → Reset all app data (plan 07): every persisted `bolid.*` store is cleared (none
 *  missed), the AI keys leave the keystore, and the app's own data files go. */
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
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useSeedKeyStore } from '@/shared/state/seedKeyStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useDashboardLayoutStore } from '@/features/live-data/model/dashboardLayoutStore';
import { useBackupStore } from '../model/backupStore';
import { useLoginBookStore } from '@/features/adaptations/model/loginBookStore';
import { useInspectionStore } from '@/features/inspection/model/inspectionStore';
import { useBatteryStore } from '@/features/battery-health/model/batteryStore';
import { useAiDiagnoseStore } from '@/features/ai-diagnose/model/aiDiagnoseStore';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';
import { useDpfStore } from '@/features/dpf/model/dpfStore';
import { useAdapterHealthStore } from '@/features/adapter-health/model/adapterHealthStore';
import {
  apiKeyStoreKey,
  API_KEY_STORE_KEY,
  setSecureStoreModule,
  type SecureStoreLike,
} from '@/shared/state/secureApiKey';
import { STORE_NAMES, NOT_BACKED_UP } from './registry';
import {
  isExportFile,
  resetAllAppData,
  resetStoreNames,
  type ResetFileSystem,
} from './resetAppData';

const files = (legacyFs as unknown as { __files: Map<string, string> }).__files;
const fileOf = (name: string) => `file:///docs/${name}.json`;

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

/** An in-memory keystore with every slot filled. */
function fakeKeystore(): Map<string, string> & { store: SecureStoreLike } {
  const slots = new Map<string, string>([
    [apiKeyStoreKey('openai'), 'sk-openai'],
    [apiKeyStoreKey('anthropic'), 'sk-ant'],
    [API_KEY_STORE_KEY, 'sk-legacy'],
  ]);
  const store: SecureStoreLike = {
    getItemAsync: async (k) => slots.get(k) ?? null,
    setItemAsync: async (k, v) => void slots.set(k, v),
    deleteItemAsync: async (k) => void slots.delete(k),
  };
  return Object.assign(slots, { store });
}

function fakeFileSystem(): ResetFileSystem & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    documentDirectory: 'file:///docs/',
    deleteAsync: async (uri) => {
      deleted.push(uri);
    },
  };
}

afterEach(() => setSecureStoreModule(undefined));

describe('resetAllAppData', () => {
  it('clears every persisted bolid.* store in the source — none is missed', () => {
    const inSource = persistedNamesInSource();
    // The scan sees the stores a backup leaves out too (it is not the backup list).
    expect(inSource).toEqual(expect.arrayContaining(['bolid.garage', ...NOT_BACKED_UP]));
    expect(inSource.length).toBeGreaterThanOrEqual(STORE_NAMES.length + NOT_BACKED_UP.length);
    expect([...resetStoreNames()].sort()).toEqual(inSource);
    expect(new Set(resetStoreNames()).size).toBe(resetStoreNames().length);
  });

  it('returns the app to a fresh state: real adapter, no garage, no history, hints back', async () => {
    const keystore = fakeKeystore();
    setSecureStoreModule(keystore.store);
    useSettingsStore.setState({ adapterSource: 'mock', theme: 'light', injectedDtcs: ['P0299'] });
    useGarageStore.setState({
      vehicles: [
        {
          id: 'user:a',
          name: 'Dacia',
          fuel: 'petrol',
          baseProfileId: 'generic',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    useVehicleStore.setState({ selectedProfileId: 'user:a' });
    useHistoryStore.getState().addDtcCheck({ profileId: 'generic', codes: [] } as never);
    useOnboardingStore.getState().dismiss('first-run');
    useDashboardLayoutStore.getState().toggleHidden('user:a', 'gauge:010C');
    useTripStore.setState({ trips: [{ header: { id: '42' } } as never] });
    useBackupStore.setState({
      records: [
        { fileName: 'b.json', createdAt: 1, bytes: 1, kind: 'backup', includesTrips: false },
      ],
    });
    useSeedKeyStore.setState({ plugins: [{ id: 'p1' } as never] });
    useLoginBookStore.setState({ byVehicle: { 'user:a': [{ address: '01' } as never] } } as never);
    await flushPendingWrites();
    expect(files.has(fileOf('bolid.garage'))).toBe(true);
    expect(files.has(fileOf('bolid.dashboard-layout'))).toBe(true);
    const fileSystem = fakeFileSystem();

    const outcome = await resetAllAppData({ fileSystem });

    expect(outcome.problems).toEqual([]);
    expect([...outcome.stores].sort()).toEqual(persistedNamesInSource());
    const settings = useSettingsStore.getState();
    expect(settings.adapterSource).toBe('ble');
    expect(settings.theme).toBe('dark');
    expect(settings.injectedDtcs).toEqual([]);
    expect(settings.ai.apiKey).toBe('');
    expect(useGarageStore.getState().vehicles).toEqual([]);
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');
    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(useOnboardingStore.getState().dismissed).toEqual([]);
    expect(useDashboardLayoutStore.getState().byProfile).toEqual({});
    expect(useTripStore.getState().trips).toEqual([]);
    expect(useBackupStore.getState().records).toEqual([]);
    expect(useSeedKeyStore.getState().plugins).toEqual([]);
    expect(useLoginBookStore.getState().byVehicle).toEqual({});

    // No persisted file is left behind, now or after a pending debounced write would have landed.
    await flushPendingWrites();
    for (const name of resetStoreNames())
      expect({ name, file: files.get(fileOf(name)) }).toEqual({ name, file: undefined });
    // Every AI key left the keystore.
    expect([...keystore.keys()]).toEqual([]);
    // The app's own data files: plugin programs, backup files, the trip recording.
    expect(fileSystem.deleted).toEqual([
      'file:///docs/seedkeys/',
      'file:///docs/backups/',
      'file:///docs/trip-42.csv',
    ]);
    expect(outcome.files).toEqual(['seedkeys/', 'backups/', 'trip-42.csv']);
  });

  it("clears the in-memory results, so no screen shows the previous car's", async () => {
    const car = { profileId: 'user:a' } as never;
    useInspectionStore.setState({ report: {} as never, ranAt: 1, ranFor: car });
    useBatteryStore.setState({
      samples: [{} as never],
      report: {} as never,
      ranAt: 1,
      ranFor: car,
    });
    useAiDiagnoseStore.setState({ snapshot: {} as never, report: {} as never, phase: 'done' });
    useModuleScanStore.setState({ results: [{} as never], lastScanTs: 1, discovery: [] });
    useDpfStore.setState({ values: [{} as never], report: {} as never });
    useAdapterHealthStore.setState({ report: {} as never });

    await resetAllAppData({ fileSystem: null });

    expect(useInspectionStore.getState()).toMatchObject({
      report: null,
      ranAt: null,
      ranFor: null,
    });
    expect(useBatteryStore.getState()).toMatchObject({ samples: [], report: null, ranFor: null });
    expect(useAiDiagnoseStore.getState()).toMatchObject({
      snapshot: null,
      report: null,
      phase: 'idle',
    });
    expect(useModuleScanStore.getState()).toMatchObject({
      results: [],
      lastScanTs: null,
      discovery: null,
    });
    expect(useDpfStore.getState()).toMatchObject({ values: [], report: null });
    expect(useAdapterHealthStore.getState().report).toBeNull();
    // The actions survive the reset (the initial state carries them).
    expect(typeof useBatteryStore.getState().setReport).toBe('function');
  });

  it("deletes the exports' staging copies in the document directory, not the stores' own files", async () => {
    useTripStore.setState({ trips: [{ header: { id: '7' } } as never] });
    const deleted: string[] = [];
    const fileSystem: ResetFileSystem = {
      documentDirectory: 'file:///docs/',
      deleteAsync: async (uri) => void deleted.push(uri),
      readDirectoryAsync: async () => [
        'bolid.garage.json',
        'bolid.errors.json',
        'trip-7.csv',
        'car-backup-2026-11-09T10-00-00-000Z.json',
        'adapter-health-2026-11-09.txt',
        'measuring-log-2026-11-09.csv',
        'bolid-sniff-golf-2026-11-09.csv',
        'bolid-report-WVWZZZ1KZ9W000001-20261109-1000.pdf',
        'bolid-fault-codes-2026.md',
        'bolid-garage-2026.json',
        'seedkeys',
        'backups',
        'SQLite',
        '.expo-internal',
      ],
    };

    const outcome = await resetAllAppData({ fileSystem });

    expect(outcome.problems).toEqual([]);
    expect(outcome.files).toEqual([
      'seedkeys/',
      'backups/',
      'trip-7.csv',
      'car-backup-2026-11-09T10-00-00-000Z.json',
      'adapter-health-2026-11-09.txt',
      'measuring-log-2026-11-09.csv',
      'bolid-sniff-golf-2026-11-09.csv',
      'bolid-report-WVWZZZ1KZ9W000001-20261109-1000.pdf',
      'bolid-fault-codes-2026.md',
      'bolid-garage-2026.json',
    ]);
    expect(deleted).toEqual(outcome.files.map((f) => `file:///docs/${f}`));
  });

  it('isExportFile skips hidden entries, directories and the persisted stores files', () => {
    const persist = new Set(['bolid.garage.json']);
    expect(isExportFile('car-backup-1.json', persist)).toBe(true);
    expect(isExportFile('bolid-report-x.html', persist)).toBe(true);
    expect(isExportFile('bolid.garage.json', persist)).toBe(false);
    expect(isExportFile('.expo-internal', persist)).toBe(false);
    expect(isExportFile('.hidden.json', persist)).toBe(false);
    expect(isExportFile('backups', persist)).toBe(false);
  });

  it('reports a directory it could not list and still deletes the known files', async () => {
    const fileSystem: ResetFileSystem = {
      documentDirectory: 'file:///docs/',
      deleteAsync: async () => undefined,
      readDirectoryAsync: async () => {
        throw new Error('denied');
      },
    };

    const outcome = await resetAllAppData({ fileSystem });

    expect(outcome.problems).toEqual(['Could not list the exported files to delete them.']);
    expect(outcome.files).toEqual(['seedkeys/', 'backups/']);
  });

  it('reports a file it could not delete and still resets the stores', async () => {
    useGarageStore.setState({ vehicles: [{ id: 'user:b' } as never] });
    const fileSystem: ResetFileSystem = {
      documentDirectory: 'file:///docs/',
      deleteAsync: async (uri) => {
        if (uri.endsWith('backups/')) throw new Error('busy');
      },
    };

    const outcome = await resetAllAppData({ fileSystem });

    expect(outcome.problems).toEqual(['Could not delete backups/.']);
    expect(outcome.files).toEqual(['seedkeys/']);
    expect(useGarageStore.getState().vehicles).toEqual([]);
  });

  it('works without a file system (tests, web)', async () => {
    useOnboardingStore.getState().dismiss('x');
    const outcome = await resetAllAppData({ fileSystem: null });
    expect(outcome.files).toEqual([]);
    expect(useOnboardingStore.getState().dismissed).toEqual([]);
  });
});
