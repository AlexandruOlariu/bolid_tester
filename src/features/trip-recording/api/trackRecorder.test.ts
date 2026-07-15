/** In the unit-test environment expo-location is not resolvable, so these assert the degrade path:
 *  capture becomes a no-op and a stopped recording simply carries no track — recording is never
 *  blocked. On-device behaviour (permission request + watchPositionAsync) can't be exercised here. */

// trackRecorder pulls in errorLogStore -> persistStorage, which statically imports expo-file-system
// (ESM, not transformed for the node test env). Mock it exactly as persistStorage.test.ts does.
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import { startTrackCapture, stopTrackCapture, isTrackCapturing } from './trackRecorder';

describe('trackRecorder', () => {
  it('degrades to an empty track without throwing when expo-location is unavailable', async () => {
    await expect(startTrackCapture()).resolves.toBeUndefined();
    expect(isTrackCapturing()).toBe(false);
    expect(stopTrackCapture()).toEqual([]);
  });

  it('stopTrackCapture is always safe to call, even if capture never started', () => {
    expect(stopTrackCapture()).toEqual([]);
    expect(isTrackCapturing()).toBe(false);
  });
});
