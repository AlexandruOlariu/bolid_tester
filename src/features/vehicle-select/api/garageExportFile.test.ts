/** Garage JSON export (plan 06) against mocked native modules. The module must load
 *  `expo-file-system/legacy`: the root entry point of this Expo SDK has no `documentDirectory` and
 *  throws for `writeAsStringAsync`, so only the legacy one is mocked here and a root import fails
 *  these tests. */
const files = new Map<string, string>();
const fsMock = {
  documentDirectory: '/docs/' as string | null,
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  deleteAsync: jest.fn(async () => undefined),
};
const sharingMock = {
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
};
jest.mock('expo-file-system/legacy', () => fsMock);
jest.mock('expo-sharing', () => sharingMock);

import { useErrorLogStore } from '@/shared/state/errorLogStore';
import type { UserVehicle } from '@/shared/vehicles';
import { garageExportFileName, saveGarageExport } from './garageExportFile';

const NOW = new Date(Date.UTC(2026, 10, 9, 10, 0, 0));
const CAR: UserVehicle = {
  id: 'user:1',
  name: 'Volkswagen 2009',
  fuel: 'diesel',
  baseProfileId: 'generic',
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  files.clear();
  fsMock.documentDirectory = '/docs/';
  fsMock.writeAsStringAsync.mockImplementation(async (uri: string, value: string) => {
    files.set(uri, value);
  });
  sharingMock.isAvailableAsync.mockImplementation(async () => true);
  useErrorLogStore.setState({ errors: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('saveGarageExport', () => {
  it('writes the garage JSON to the document directory and shares it', async () => {
    const uri = await saveGarageExport([CAR], NOW);
    expect(uri).toBe(`/docs/${garageExportFileName(NOW)}`);
    expect(uri).toBe('/docs/bolid-garage-2026-11-09T10-00-00-000Z.json');
    const body = JSON.parse(files.get(uri as string) as string) as {
      kind: string;
      exportedAt: string;
      vehicles: UserVehicle[];
    };
    expect(body.kind).toBe('bolid.garage');
    expect(body.exportedAt).toBe(NOW.toISOString());
    expect(body.vehicles.map((v) => v.id)).toEqual(['user:1']);
    expect(sharingMock.shareAsync).toHaveBeenCalledWith(uri, {
      mimeType: 'application/json',
      dialogTitle: 'Share garage',
    });
    expect(useErrorLogStore.getState().errors).toEqual([]);
  });

  it('still writes the file when no share sheet is available', async () => {
    sharingMock.isAvailableAsync.mockImplementation(async () => false);
    const uri = await saveGarageExport([CAR], NOW);
    expect(files.has(uri as string)).toBe(true);
    expect(sharingMock.shareAsync).not.toHaveBeenCalled();
  });

  it('logs a warning and returns null when there is no document directory', async () => {
    fsMock.documentDirectory = null;
    expect(await saveGarageExport([CAR], NOW)).toBeNull();
    expect([...files.keys()].some((k) => k.includes('bolid-garage-'))).toBe(false);
    const [entry] = useErrorLogStore.getState().errors;
    expect(entry).toMatchObject({ source: 'vehicle-select/export', severity: 'warning' });
  });

  it('logs a warning and returns null when the write fails', async () => {
    fsMock.writeAsStringAsync.mockImplementation(async () => {
      throw new Error('disk full');
    });
    expect(await saveGarageExport([CAR], NOW)).toBeNull();
    const [entry] = useErrorLogStore.getState().errors;
    expect(entry).toMatchObject({ source: 'vehicle-select/export', severity: 'warning' });
  });
});
