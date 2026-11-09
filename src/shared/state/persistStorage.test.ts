/** debouncedStorage flush timing (findings F6/F7). persistStorage imports expo-file-system (ESM,
 *  not transformed for the node test env), so we mock it; the wrapper itself is tested against a
 *  fake inner storage with fake timers. */
/** `null` reproduces web, where expo-file-system has no document directory (read when the module
 *  under test loads, so the web tests below load a fresh copy with `jest.isolateModules`). */
let mockDocDir: string | null = '/tmp/bolid-test/';
jest.mock('expo-file-system/legacy', () => ({
  get documentDirectory() {
    return mockDocDir;
  },
  get cacheDirectory() {
    return mockDocDir;
  },
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import type { StateStorage } from 'zustand/middleware';
import { debouncedStorage, flushPendingWrites, webStateStorage } from './persistStorage';

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

/** Plan 28: on web there is no document directory, so every persisted store must fall back to the
 *  browser's localStorage instead of silently persisting nothing. */
class FakeLocalStorage {
  readonly data = new Map<string, string>();
  failWith: Error | null = null;
  getItem(k: string): string | null {
    if (this.failWith) throw this.failWith;
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.failWith) throw this.failWith;
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    if (this.failWith) throw this.failWith;
    this.data.delete(k);
  }
}

describe('web backend (localStorage)', () => {
  const g = globalThis as { localStorage?: unknown };
  afterEach(() => {
    delete g.localStorage;
    mockDocDir = '/tmp/bolid-test/';
  });

  /** A fresh persistStorage module whose document directory is null, as on web. */
  async function loadWebModule(): Promise<typeof import('./persistStorage')> {
    mockDocDir = null;
    let mod!: typeof import('./persistStorage');
    await jest.isolateModulesAsync(async () => {
      mod = await import('./persistStorage');
    });
    return mod;
  }

  it('round-trips a store under its own bolid.<area> key when there is no document directory', async () => {
    const ls = new FakeLocalStorage();
    g.localStorage = ls;
    const { fileStateStorage, persistBackend } = await loadWebModule();
    expect(persistBackend()).toBe('localStorage');

    await fileStateStorage.setItem('bolid.settings', '{"state":{"theme":"dark"},"version":7}');
    expect(ls.data.get('bolid.settings')).toBe('{"state":{"theme":"dark"},"version":7}');
    await expect(fileStateStorage.getItem('bolid.settings')).resolves.toBe(
      '{"state":{"theme":"dark"},"version":7}',
    );
    await fileStateStorage.removeItem('bolid.settings');
    await expect(fileStateStorage.getItem('bolid.settings')).resolves.toBeNull();
  });

  it('is a no-op (in-memory only) without localStorage', async () => {
    const { fileStateStorage, persistBackend } = await loadWebModule();
    expect(persistBackend()).toBe('none');
    await fileStateStorage.setItem('bolid.settings', '{}');
    await expect(fileStateStorage.getItem('bolid.settings')).resolves.toBeNull();
  });

  it('logs a failing localStorage as a persist warning instead of throwing', async () => {
    const ls = new FakeLocalStorage();
    ls.failWith = new Error('QuotaExceededError');
    g.localStorage = ls;
    const { fileStateStorage, setPersistLogger } = await loadWebModule();
    const logged: unknown[] = [];
    setPersistLogger((input) => logged.push(input));

    await expect(fileStateStorage.setItem('bolid.history', 'x')).resolves.toBeUndefined();
    await expect(fileStateStorage.getItem('bolid.history')).resolves.toBeNull();
    await expect(fileStateStorage.removeItem('bolid.history')).resolves.toBeUndefined();
    expect(logged).toEqual([
      expect.objectContaining({
        source: 'persist',
        severity: 'warning',
        context: { store: 'bolid.history', op: 'write' },
      }),
      expect.objectContaining({ context: { store: 'bolid.history', op: 'read' } }),
      expect.objectContaining({ context: { store: 'bolid.history', op: 'remove' } }),
    ]);
    // The error log's own key never logs (it would re-enter the store).
    await fileStateStorage.setItem('bolid.errors', 'x');
    expect(logged).toHaveLength(3);
  });

  it('a blocked localStorage getter (SecurityError) reads as no storage', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: access denied');
      },
    });
    const { browserLocalStorage } = await loadWebModule();
    expect(browserLocalStorage()).toBeNull();
  });

  it('native keeps the file backend even when localStorage exists', async () => {
    g.localStorage = new FakeLocalStorage();
    const { persistBackend } = await import('./persistStorage');
    expect(persistBackend()).toBe('file');
  });
});

describe('webStateStorage', () => {
  it('reads and writes through the injected storage', () => {
    const ls = new FakeLocalStorage();
    const s = webStateStorage(() => ls);
    s.setItem('bolid.trips', '[1]');
    expect(s.getItem('bolid.trips')).toBe('[1]');
    s.removeItem('bolid.trips');
    expect(ls.data.size).toBe(0);
  });
});
