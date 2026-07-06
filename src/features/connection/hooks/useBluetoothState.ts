import { useEffect, useState } from 'react';
import { State } from 'react-native-ble-plx';
import { getBleManager } from '@/shared/transports/ble/manager';
import { logError } from '@/shared/state/errorLogStore';

export interface BluetoothState {
  /** Raw adapter state from react-native-ble-plx. */
  state: State;
  /** Powered on and ready to scan/connect. */
  ready: boolean;
  /** Radio is off — the user can turn it on (Android) or via Control Center (iOS). */
  poweredOff: boolean;
  /** App lacks Bluetooth authorization (iOS permission, or Android permission revoked). */
  unauthorized: boolean;
  /** This device has no Bluetooth LE support. */
  unsupported: boolean;
  /** Transient — the adapter state is still settling (Unknown/Resetting). */
  checking: boolean;
}

/** Track the phone's Bluetooth radio state live. Subscribes to `onStateChange` (emitting the
 *  current state immediately) and cleans up on unmount. Constructs the BleManager lazily, so pass
 *  `enabled={false}` in simulator mode to avoid touching native BLE. */
export function useBluetoothState(enabled = true): BluetoothState {
  const [state, setState] = useState<State>(State.Unknown);

  useEffect(() => {
    if (!enabled) {
      setState(State.Unknown);
      return;
    }
    let sub: { remove: () => void } | undefined;
    try {
      sub = getBleManager().onStateChange((s) => setState(s), true);
    } catch (e) {
      // BleManager can throw on unsupported platforms (e.g. web/Expo Go without the native module).
      logError({ source: 'connection/bluetooth', error: e, severity: 'warning' });
      setState(State.Unsupported);
    }
    return () => sub?.remove();
  }, [enabled]);

  return {
    state,
    ready: state === State.PoweredOn,
    poweredOff: state === State.PoweredOff,
    unauthorized: state === State.Unauthorized,
    unsupported: state === State.Unsupported,
    checking: state === State.Unknown || state === State.Resetting,
  };
}
