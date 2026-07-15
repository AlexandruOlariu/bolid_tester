/** Ring buffer + throttled publish for the adapter I/O log (finding F5). Module-level state is reset
 *  per test via jest.resetModules() + a fresh require, and timers are faked so the ~4 Hz publish
 *  throttle is deterministic. */

type AdapterLogModule = typeof import('./adapterLog');

function fresh(): AdapterLogModule {
  jest.resetModules();
  // Deliberate require(): re-import after resetModules() to get fresh module-level ring-buffer state
  // (an ESM `import` is hoisted and cached, so it can't reset per test).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./adapterLog') as AdapterLogModule;
}

describe('adapterLog ring buffer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appends in order and snapshots chronologically', () => {
    const mod = fresh();
    mod.appendAdapterLog({ dir: 'tx', text: 'a', ts: 1 });
    mod.appendAdapterLog({ dir: 'rx', text: 'b', ts: 2 });
    const snap = mod.adapterLogSnapshot();
    expect(snap.map((e) => e.text)).toEqual(['a', 'b']);
  });

  it('wraps at capacity, evicting the oldest entries', () => {
    const mod = fresh();
    const total = mod.ADAPTER_LOG_CAPACITY + 50;
    for (let i = 0; i < total; i++) mod.appendAdapterLog({ dir: 'tx', text: `c${i}`, ts: i });
    const snap = mod.adapterLogSnapshot();
    expect(snap).toHaveLength(mod.ADAPTER_LOG_CAPACITY);
    expect(snap[0].text).toBe('c50'); // first 50 evicted
    expect(snap[snap.length - 1].text).toBe(`c${total - 1}`);
  });

  it('publishes the leading append immediately, then coalesces a burst into one trailing flush', () => {
    const mod = fresh();
    const store = mod.useAdapterLogStore;
    expect(store.getState().entries).toHaveLength(0);

    // First append: nothing published recently, so it lands immediately.
    mod.appendAdapterLog({ dir: 'tx', text: 'a', ts: 1 });
    expect(store.getState().entries).toHaveLength(1);

    // A rapid burst inside the throttle window does NOT update the store yet.
    mod.appendAdapterLog({ dir: 'rx', text: 'b', ts: 2 });
    mod.appendAdapterLog({ dir: 'rx', text: 'c', ts: 3 });
    expect(store.getState().entries).toHaveLength(1);

    // The trailing flush after the throttle interval catches the store up to the full buffer.
    jest.advanceTimersByTime(mod.ADAPTER_LOG_PUBLISH_INTERVAL_MS);
    expect(store.getState().entries.map((e) => e.text)).toEqual(['a', 'b', 'c']);
  });

  it('clear empties the buffer and publishes immediately', () => {
    const mod = fresh();
    mod.appendAdapterLog({ dir: 'tx', text: 'x', ts: 1 });
    mod.clearAdapterLog();
    expect(mod.adapterLogSnapshot()).toEqual([]);
    expect(mod.useAdapterLogStore.getState().entries).toEqual([]);
  });
});
