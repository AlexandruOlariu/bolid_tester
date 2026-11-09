/** Runtime Bluetooth permissions.
 *  - BLE (scan + connect): Android 12+ needs BLUETOOTH_SCAN/CONNECT; older needs FINE_LOCATION
 *    (BLE scan results are location data there).
 *  - Classic Bluetooth / SPP (plan 27; bonded list + RFCOMM connect, no scanning): Android 12+
 *    needs BLUETOOTH_CONNECT only; older Android needs no runtime permission at all (the install-time
 *    BLUETOOTH / BLUETOOTH_ADMIN from the library's manifest cover it), so it never prompts there.
 *  iOS (plan 09): there is no runtime request API — iOS shows the Bluetooth prompt (text from
 *  NSBluetoothAlwaysUsageDescription in app.json) the first time CoreBluetooth is used, and a denial
 *  surfaces as ble-plx `State.Unauthorized`. So every function here resolves `true` at once off
 *  Android, before `PermissionsAndroid` is touched at all. */
import { Platform, PermissionsAndroid, type Permission } from 'react-native';

const isAndroid = () => Platform.OS === 'android';

function androidVersion(): number {
  return typeof Platform.Version === 'number'
    ? Platform.Version
    : parseInt(String(Platform.Version), 10);
}

/** The runtime permissions this Android version needs for BLE. */
function blePermissions(): Permission[] {
  return androidVersion() >= 31
    ? [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
}

/** The runtime permissions this Android version needs for Classic Bluetooth (none before API 31). */
function classicPermissions(): Permission[] {
  return androidVersion() >= 31 ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] : [];
}

/** Whether every permission in `perms` is granted — never shows a system prompt. */
async function checkAll(perms: Permission[]): Promise<boolean> {
  if (perms.length === 0) return true;
  try {
    const granted = await Promise.all(perms.map((p) => PermissionsAndroid.check(p)));
    return granted.every(Boolean);
  } catch {
    return false;
  }
}

/** Ask for every permission in `perms` (one system dialog); true when all are granted. */
async function requestAll(perms: Permission[]): Promise<boolean> {
  if (perms.length === 0) return true;
  try {
    const res = await PermissionsAndroid.requestMultiple(perms);
    return perms.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

export async function requestBlePermissions(): Promise<boolean> {
  if (!isAndroid()) return true;
  return requestAll(blePermissions());
}

/** Whether the Classic Bluetooth permission is already granted — never shows a system prompt. For
 *  passive re-reads (e.g. on app resume): a prompt pauses the activity, and its resume must not
 *  trigger another prompt. Always true before Android 12. */
export async function checkClassicBluetoothPermissions(): Promise<boolean> {
  if (!isAndroid()) return true;
  return checkAll(classicPermissions());
}

/** Ask for the Classic Bluetooth permission (BLUETOOTH_CONNECT, "Nearby devices") on Android 12+;
 *  resolves true without a prompt on older Android and on other platforms. */
export async function requestClassicBluetoothPermissions(): Promise<boolean> {
  if (!isAndroid()) return true;
  return requestAll(classicPermissions());
}
