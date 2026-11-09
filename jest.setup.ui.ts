/** Setup for the `ui` Jest project (jest-expo + React Native Testing Library). See docs/testing.md →
 *  "Component tests". Every native boundary the screens touch gets a deterministic test double here,
 *  so a test renders a real screen against the real zustand stores and, where it connects, the real
 *  `connectionService` driving `MockTransport` (the simulator). */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above the
   imports, so they must load their doubles with a lazy require(). */

import { cleanup } from '@testing-library/react-native';
import { cancelPendingWrites, resetStores } from './test/resetStores';
import { useSessionStore } from '@/shared/state/sessionStore';
import { disconnect } from '@/features/connection/api/connectionService';

// --- Bluetooth: the BLE stack is never touched in tests; the radio reports PoweredOn. -------------
jest.mock('react-native-ble-plx', () => {
  const State = {
    Unknown: 'Unknown',
    Resetting: 'Resetting',
    Unsupported: 'Unsupported',
    Unauthorized: 'Unauthorized',
    PoweredOff: 'PoweredOff',
    PoweredOn: 'PoweredOn',
  };
  return {
    State,
    BleManager: jest.fn(() => ({
      state: jest.fn(async () => State.PoweredOn),
      onStateChange: jest.fn((listener: (s: string) => void, emitCurrent?: boolean) => {
        if (emitCurrent) listener(State.PoweredOn);
        return { remove: jest.fn() };
      }),
      startDeviceScan: jest.fn(),
      stopDeviceScan: jest.fn(),
      connectedDevices: jest.fn(async () => []),
      enable: jest.fn(async () => undefined),
      destroy: jest.fn(),
    })),
  };
});
// Permissions resolve granted, so a scan or connect gets past the prompt deterministically.
jest.mock('@/shared/transports/ble/permissions', () => ({
  requestBlePermissions: jest.fn(async () => true),
}));

// --- Filesystem + the tolerant (variable-specifier) native imports. --------------------------------
jest.mock('expo-file-system/legacy', () => require('./test/mocks/fileSystem').fileSystemMock);
jest.mock('expo-file-system', () => require('./test/mocks/fileSystem').fileSystemMock);
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(async () => undefined),
}));
// Print-to-PDF (plan 15): "prints" a placeholder PDF into the in-memory cache directory.
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(async () => {
    const uri = 'file:///test-cache/print.pdf';
    require('./test/mocks/fileSystem').memoryFiles.set(uri, '%PDF-1.4 test');
    return { uri, numberOfPages: 1 };
  }),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied' })),
  scheduleNotificationAsync: jest.fn(async () => 'test-notification'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  Accuracy: { High: 4, Balanced: 3 },
}));
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => values.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      values.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      values.delete(k);
    }),
  };
});
jest.mock('expo-updates', () => ({
  isEnabled: false,
  checkForUpdateAsync: jest.fn(async () => ({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(async () => ({ isNew: false })),
  reloadAsync: jest.fn(async () => undefined),
}));

// --- Navigation + safe area. ------------------------------------------------------------------------
jest.mock('expo-router', () => require('./test/mocks/router').expoRouterMock);
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Store/file reset between tests — see test/resetStores.ts. `afterAll` cancels the debounced
// persist writes the file's last test scheduled, so no timer is left open when the file ends.
beforeEach(() => resetStores());
afterAll(() => cancelPendingWrites());

// A test that connected the simulator leaves a live session (and its status watcher) behind; unmount
// the rendered tree first (so the teardown below updates no mounted screen), then close the session so
// the next test starts disconnected with no stray timers.
afterEach(async () => {
  cleanup();
  if (!useSessionStore.getState().session) return;
  await disconnect();
});
