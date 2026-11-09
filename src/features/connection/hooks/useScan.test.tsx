/** The scan's radio-state guard (plan 09): on iOS a denied Bluetooth prompt is only visible as
 *  ble-plx `State.Unauthorized` (iOS has no runtime permission request, so `requestBlePermissions`
 *  resolves true), and the scan must report it as a permission problem, not "Bluetooth is off". */
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { State, type BleManager } from 'react-native-ble-plx';
import * as bleManager from '@/shared/transports/ble/manager';
import { useSessionStore } from '@/shared/state/sessionStore';
import { scanBlockedMessage, useScan } from './useScan';

function fakeManager(state: State) {
  return {
    state: jest.fn(async () => state),
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    connectedDevices: jest.fn(async () => []),
  } as unknown as BleManager;
}

afterEach(() => jest.restoreAllMocks());

describe('scanBlockedMessage', () => {
  it('lets a powered-on radio scan', () => {
    expect(scanBlockedMessage(State.PoweredOn, 'ios')).toBeNull();
  });

  it('reports a denied permission as such, with the platform’s own fix', () => {
    expect(scanBlockedMessage(State.Unauthorized, 'ios')).toMatch(
      /permission denied.*Settings → Bolid Tester/,
    );
    expect(scanBlockedMessage(State.Unauthorized, 'ios')).not.toMatch(/Nearby devices|Android/);
    expect(scanBlockedMessage(State.Unauthorized, 'android')).toMatch(/Nearby devices/);
  });

  it('tells a settling radio apart from a powered-off one', () => {
    expect(scanBlockedMessage(State.PoweredOff, 'ios')).toMatch(/Bluetooth is off/);
    expect(scanBlockedMessage(State.Unknown, 'ios')).toMatch(/not ready yet/);
    expect(scanBlockedMessage(State.Resetting, 'android')).toMatch(/not ready yet/);
  });
});

describe('useScan on iOS', () => {
  it('a scan with Bluetooth unauthorized sets the iOS permission error and never scans', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const manager = fakeManager(State.Unauthorized);
    jest.spyOn(bleManager, 'getBleManager').mockReturnValue(manager);
    const { result } = renderHook(() => useScan());

    await act(async () => {
      await result.current.start();
    });

    expect(useSessionStore.getState().error).toMatch(
      /Allow Bluetooth for Bolid Tester in Settings/,
    );
    expect(manager.startDeviceScan).not.toHaveBeenCalled();
    expect(result.current.scanning).toBe(false);
  });

  it('a powered-on radio starts the scan', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const manager = fakeManager(State.PoweredOn);
    jest.spyOn(bleManager, 'getBleManager').mockReturnValue(manager);
    const { result, unmount } = renderHook(() => useScan());

    await act(async () => {
      await result.current.start();
    });

    expect(manager.startDeviceScan).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().error).toBeNull();
    unmount();
  });
});
