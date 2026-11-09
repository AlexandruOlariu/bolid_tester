/** Runtime Bluetooth permissions per Android version: BLE asks SCAN + CONNECT on API 31+ and fine
 *  location before; Classic Bluetooth (plan 27) asks only CONNECT on API 31+ and nothing before —
 *  an SPP adapter never needs the location prompt. */

const rn = {
  Platform: { OS: 'android', Version: 31 as number | string },
  PermissionsAndroid: {
    PERMISSIONS: {
      BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
      BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
      ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
    },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    check: jest.fn(async (_p: string) => true),
    requestMultiple: jest.fn(async (perms: string[]) =>
      Object.fromEntries(perms.map((p) => [p, 'granted'])),
    ),
  },
};
jest.mock('react-native', () => rn);

import {
  checkClassicBluetoothPermissions,
  requestBlePermissions,
  requestClassicBluetoothPermissions,
} from './permissions';

const { PERMISSIONS } = rn.PermissionsAndroid;

beforeEach(() => {
  rn.Platform.OS = 'android';
  rn.Platform.Version = 31;
});

describe('Classic Bluetooth permissions', () => {
  it('asks only BLUETOOTH_CONNECT on Android 12+', async () => {
    await expect(requestClassicBluetoothPermissions()).resolves.toBe(true);
    expect(rn.PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([
      PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    await expect(checkClassicBluetoothPermissions()).resolves.toBe(true);
    expect(rn.PermissionsAndroid.check).toHaveBeenCalledWith(PERMISSIONS.BLUETOOTH_CONNECT);
  });

  it('reports a denial on Android 12+', async () => {
    rn.PermissionsAndroid.requestMultiple.mockResolvedValueOnce({
      [PERMISSIONS.BLUETOOTH_CONNECT]: 'denied',
    });
    await expect(requestClassicBluetoothPermissions()).resolves.toBe(false);
    rn.PermissionsAndroid.check.mockResolvedValueOnce(false);
    await expect(checkClassicBluetoothPermissions()).resolves.toBe(false);
  });

  it('needs no runtime permission (no location prompt) before Android 12', async () => {
    rn.Platform.Version = '30';
    await expect(requestClassicBluetoothPermissions()).resolves.toBe(true);
    await expect(checkClassicBluetoothPermissions()).resolves.toBe(true);
    expect(rn.PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
    expect(rn.PermissionsAndroid.check).not.toHaveBeenCalled();
  });
});

describe('BLE permissions', () => {
  it('asks SCAN + CONNECT on Android 12+ and fine location before', async () => {
    await requestBlePermissions();
    expect(rn.PermissionsAndroid.requestMultiple).toHaveBeenLastCalledWith([
      PERMISSIONS.BLUETOOTH_SCAN,
      PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    rn.Platform.Version = 29;
    await requestBlePermissions();
    expect(rn.PermissionsAndroid.requestMultiple).toHaveBeenLastCalledWith([
      PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
  });

  it('never prompts off Android', async () => {
    rn.Platform.OS = 'ios';
    await expect(requestBlePermissions()).resolves.toBe(true);
    await expect(requestClassicBluetoothPermissions()).resolves.toBe(true);
    expect(rn.PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  });
});
