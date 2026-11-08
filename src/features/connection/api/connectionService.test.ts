/** Adapter-source switching (plan 01 review): a simulator session — connected or still connecting —
 *  must never survive a switch to the real adapter. Runs the real connectionService against the
 *  MockTransport; the BLE modules (react-native / ble-plx) and the file system are mocked out. */
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
jest.mock('@/shared/transports/ble/BleTransport', () => ({ BleTransport: jest.fn() }));
jest.mock('@/shared/transports/ble/manager', () => ({ getBleManager: jest.fn() }));
jest.mock('@/shared/transports/ble/permissions', () => ({
  requestBlePermissions: jest.fn(async () => false),
}));

import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { connect, disconnect, switchAdapterSource, switchToRealAdapter } from './connectionService';

beforeEach(async () => {
  await disconnect();
  useSettingsStore.setState({ adapterSource: 'mock', injectedDtcs: [] });
});

afterAll(async () => {
  await disconnect();
});

describe('switchToRealAdapter', () => {
  it('tears down a connected simulator session', async () => {
    await connect();
    expect(useSessionStore.getState().status).toBe('connected');
    expect(useSessionStore.getState().deviceId).toBe('mock');

    await switchToRealAdapter();
    const s = useSessionStore.getState();
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(s.status).toBe('disconnected');
    expect(s.session).toBeNull();
    expect(s.deviceId).toBeNull();
  });

  it('drops a simulator connect that is still in flight instead of publishing it', async () => {
    const pending = connect();
    expect(['connecting', 'initializing']).toContain(useSessionStore.getState().status);

    await switchToRealAdapter();
    await pending;
    const s = useSessionStore.getState();
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(s.status).toBe('disconnected');
    expect(s.session).toBeNull();
    expect(s.error).toBeNull();
  });
});

describe('switchAdapterSource', () => {
  it('is a no-op when the source is unchanged', async () => {
    await connect();
    await switchAdapterSource('mock');
    expect(useSessionStore.getState().status).toBe('connected');
  });

  it('a connect started after the switch is unaffected', async () => {
    await switchAdapterSource('ble');
    await switchAdapterSource('mock');
    await connect();
    expect(useSessionStore.getState().status).toBe('connected');
  });
});
