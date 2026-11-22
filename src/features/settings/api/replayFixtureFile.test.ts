/** Settings replay-fixture write + share (plan 02) against mocked native modules. The module must
 *  load `expo-file-system/legacy`: the root entry point of this Expo SDK has no `documentDirectory`
 *  and throws for `writeAsStringAsync`, so only the legacy one is mocked here. */
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

import type { ReplayFixture } from '@/shared/obd-core';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import type { ReplayExportInput } from '../model/replayExport';
import { saveReplayFixture } from './replayFixtureFile';

const INPUT: ReplayExportInput = {
  log: [
    { dir: 'tx', text: '03', ts: 1 },
    { dir: 'rx', text: '4300\r', ts: 2 },
  ],
  flow: 'faults',
  vehicleId: 'golf-plus-2009-20tdi',
  source: 'car',
  appVersion: '0.2.0',
  now: new Date(Date.UTC(2026, 10, 9, 10, 0, 0)),
};

beforeEach(() => {
  files.clear();
  fsMock.documentDirectory = '/docs/';
  fsMock.writeAsStringAsync.mockImplementation(async (uri: string, value: string) => {
    files.set(uri, value);
  });
  sharingMock.isAvailableAsync.mockImplementation(async () => true);
  sharingMock.shareAsync.mockClear();
  useErrorLogStore.setState({ errors: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('saveReplayFixture', () => {
  it('writes the fixture JSON to the document directory and shares it', async () => {
    const fileName = await saveReplayFixture(INPUT);
    expect(fileName).toMatch(/^bolid-replay-golf-plus-2009-20tdi-faults-.+[.]json$/);
    const body = files.get(`/docs/${fileName}`);
    expect(body).toBeDefined();
    const fixture = JSON.parse(body as string) as ReplayFixture;
    expect(fixture.pairs['03']).toBe('4300');
    expect(fixture.meta).toMatchObject({ source: 'car', flow: 'faults' });
    expect(sharingMock.shareAsync).toHaveBeenCalledWith(
      `/docs/${fileName}`,
      expect.objectContaining({ mimeType: 'application/json' }),
    );
  });

  it('logs a warning and returns null without a document directory', async () => {
    fsMock.documentDirectory = null;
    expect(await saveReplayFixture(INPUT)).toBeNull();
    expect(sharingMock.shareAsync).not.toHaveBeenCalled();
    const errors = useErrorLogStore.getState().errors;
    expect(errors[0]).toMatchObject({ source: 'settings/replay-export', severity: 'warning' });
  });

  it('logs a failed write and returns null', async () => {
    fsMock.writeAsStringAsync.mockImplementation(async (uri: string) => {
      if (uri.includes('bolid-replay-')) throw new Error('disk full');
    });
    expect(await saveReplayFixture(INPUT)).toBeNull();
    const errors = useErrorLogStore.getState().errors;
    expect(errors[0]).toMatchObject({ source: 'settings/replay-export', message: 'disk full' });
  });
});
