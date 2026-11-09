/** debouncedStorage flush timing (findings F6/F7). persistStorage imports expo-file-system (ESM,
 *  not transformed for the node test env), so we mock it; the wrapper itself is tested against a
 *  fake inner storage with fake timers. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import type { StateStorage } from 'zustand/middleware';
import { debouncedStorage, flushPendingWrites } from './persistStorage';

function fakeInner() {
  return {
    getItem: jest.fn(async (): Promise<string | null> => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  } satisfies StateStorage;
}

describe('debouncedStorage', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('coalesces a burst of writes into a single trailing flush with the last value', () => {
    const inner = fakeInner();
    const s = debouncedStorage(inner, 500);

    s.setItem('k', '1');
    s.setItem('k', '2');
    s.setItem('k', '3');
    expect(inner.setItem).not.toHaveBeenCalled();

    jest.advanceTimersByTime(499);
    expect(inner.setItem).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(inner.setItem).toHaveBeenCalledTimes(1);
    expect(inner.setItem).toHaveBeenCalledWith('k', '3');
  });

  it('debounces each key independently', () => {
    const inner = fakeInner();
    const s = debouncedStorage(inner, 500);

    s.setItem('a', 'x');
    jest.advanceTimersByTime(300);
    s.setItem('b', 'y'); // resets only b's timer
    jest.advanceTimersByTime(200); // a hits 500 -> flush; b at 200
    expect(inner.setItem).toHaveBeenCalledTimes(1);
    expect(inner.setItem).toHaveBeenLastCalledWith('a', 'x');

    jest.advanceTimersByTime(300); // b hits 500
    expect(inner.setItem).toHaveBeenCalledTimes(2);
    expect(inner.setItem).toHaveBeenLastCalledWith('b', 'y');
  });

  it('passes getItem straight through (immediate hydration)', async () => {
    const inner = fakeInner();
    inner.getItem.mockResolvedValueOnce('hydrated');
    const s = debouncedStorage(inner, 500);
    await expect(s.getItem('k')).resolves.toBe('hydrated');
    expect(inner.getItem).toHaveBeenCalledWith('k');
  });

  it('removeItem cancels a pending write so a stale flush cannot resurrect a cleared key', () => {
    const inner = fakeInner();
    const s = debouncedStorage(inner, 500);

    s.setItem('k', '1');
    s.removeItem('k');
    jest.advanceTimersByTime(500);

    expect(inner.setItem).not.toHaveBeenCalled();
    expect(inner.removeItem).toHaveBeenCalledWith('k');
  });

  it('flushNow writes the pending value immediately and cancels the timer', async () => {
    const inner = fakeInner();
    const s = debouncedStorage(inner, 500);

    s.setItem('k', '1');
    s.setItem('k', '2');
    await s.flushNow('k');
    expect(inner.setItem).toHaveBeenCalledTimes(1);
    expect(inner.setItem).toHaveBeenCalledWith('k', '2');

    // the cancelled timer never fires a second (stale) write
    jest.advanceTimersByTime(1000);
    expect(inner.setItem).toHaveBeenCalledTimes(1);
  });

  it('flushNow without a key flushes every pending key; nothing pending is a no-op', async () => {
    const inner = fakeInner();
    const s = debouncedStorage(inner, 500);
    await s.flushNow();
    expect(inner.setItem).not.toHaveBeenCalled();

    s.setItem('a', 'x');
    s.setItem('b', 'y');
    await s.flushNow();
    expect(inner.setItem).toHaveBeenCalledWith('a', 'x');
    expect(inner.setItem).toHaveBeenCalledWith('b', 'y');
    jest.advanceTimersByTime(1000);
    expect(inner.setItem).toHaveBeenCalledTimes(2);
  });

  it('flushPendingWrites flushes every debounced storage and waits for the inner write', async () => {
    let landed = false;
    const slow = fakeInner();
    slow.setItem.mockImplementation(() =>
      Promise.resolve()
        .then(() => undefined)
        .then(() => {
          landed = true;
          return undefined;
        }),
    );
    const a = debouncedStorage(slow, 500);
    const other = fakeInner();
    const b = debouncedStorage(other, 2000);
    a.setItem('x', '1');
    b.setItem('y', '2');

    await flushPendingWrites();
    expect(landed).toBe(true);
    expect(slow.setItem).toHaveBeenCalledWith('x', '1');
    expect(other.setItem).toHaveBeenCalledWith('y', '2');
  });
});
