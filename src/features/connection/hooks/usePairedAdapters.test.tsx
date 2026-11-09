/** The Classic Bluetooth picker's foreground re-read (plan 27): the system permission dialog pauses
 *  the activity, so its close fires an AppState 'active' change. That re-read must never prompt a
 *  second time, and is skipped while the first request (dialog included) is still pending. */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import {
  checkClassicBluetoothPermissions,
  requestClassicBluetoothPermissions,
} from '@/shared/transports/ble/permissions';
import { listPairedAdapters } from '../api/connectionService';
import { usePairedAdapters } from './usePairedAdapters';

jest.mock('../api/connectionService', () => ({
  listPairedAdapters: jest.fn(async () => [{ address: '00:11:22:33:44:55', name: 'OBDII' }]),
}));

const request = requestClassicBluetoothPermissions as jest.Mock;
const check = checkClassicBluetoothPermissions as jest.Mock;
const list = listPairedAdapters as jest.Mock;

const spies: jest.SpyInstance[] = [];

function captureAppState() {
  let handler: ((s: AppStateStatus) => void) | null = null;
  spies.push(
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      handler = cb as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    }),
  );
  return (s: AppStateStatus) => handler?.(s);
}

afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

describe('usePairedAdapters', () => {
  it('re-reads on resume without prompting for the permission again', async () => {
    const emit = captureAppState();
    const { result } = renderHook(() => usePairedAdapters(true));
    await act(async () => undefined);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.devices).toHaveLength(1);

    await act(async () => emit('active'));
    expect(request).toHaveBeenCalledTimes(1); // no second system dialog
    expect(check).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('skips the resume re-read while the permission dialog is still open', async () => {
    const emit = captureAppState();
    let grant: (v: boolean) => void = () => undefined;
    request.mockImplementationOnce(() => new Promise<boolean>((res) => (grant = res)));
    renderHook(() => usePairedAdapters(true));
    // The dialog pauses the activity; closing it resumes before the request promise settles.
    await act(async () => emit('active'));
    expect(check).not.toHaveBeenCalled();
    await act(async () => grant(true));
    expect(request).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('a resume after a denial reports the denial without asking again', async () => {
    const emit = captureAppState();
    request.mockResolvedValueOnce(false);
    check.mockResolvedValueOnce(false);
    const { result } = renderHook(() => usePairedAdapters(true));
    await act(async () => undefined);
    expect(result.current.error).toMatch(/permission denied/);
    await act(async () => emit('active'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/permission denied/);
    expect(list).not.toHaveBeenCalled();
  });
});
