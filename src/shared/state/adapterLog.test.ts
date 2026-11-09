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
    jest.advanceTimersByTime(mod.ADAPTER_LOG_PUBLISH_INTERVAL_MS);
    // The store counts what fell off, so a replay-fixture export can warn it starts mid-session.
    expect(mod.useAdapterLogStore.getState().dropped).toBe(50);
    mod.clearAdapterLog();
    expect(mod.useAdapterLogStore.getState().dropped).toBe(0);
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

  describe('origin — how the log was recorded (plan W2)', () => {
    const SIM_GOLF = { source: 'simulator' as const, simulatedVehicleId: 'golf-plus-2009-20tdi' };

    it('is stamped by a connect, completed with the link, and published', () => {
      const mod = fresh();
      expect(mod.adapterLogOrigin()).toBeNull();
      mod.beginAdapterLogRecording(SIM_GOLF);
      mod.appendAdapterLog({ dir: 'tx', text: 'ATZ', ts: 1 });
      mod.noteAdapterLogLink({ adapter: 'ELM327 v2.2', protocol: 'ISO_15765_4_CAN_11_500' });
      const want = { ...SIM_GOLF, adapter: 'ELM327 v2.2', protocol: 'ISO_15765_4_CAN_11_500' };
      expect(mod.adapterLogOrigin()).toEqual(want);
      expect(mod.useAdapterLogStore.getState().origin).toEqual(want);
    });

    it('a reconnect to the same recording keeps the log and its link details', () => {
      const mod = fresh();
      mod.beginAdapterLogRecording(SIM_GOLF);
      mod.appendAdapterLog({ dir: 'tx', text: 'ATZ', ts: 1 });
      mod.noteAdapterLogLink({ adapter: 'ELM327 v2.2', protocol: 'ISO_15765_4_CAN_11_500' });
      mod.beginAdapterLogRecording(SIM_GOLF);
      expect(mod.adapterLogSnapshot()).toHaveLength(1);
      expect(mod.adapterLogOrigin()?.adapter).toBe('ELM327 v2.2');
    });

    it('another source or simulated car clears the log first, so a fixture never mixes two', () => {
      const mod = fresh();
      mod.beginAdapterLogRecording(SIM_GOLF);
      mod.appendAdapterLog({ dir: 'tx', text: 'ATZ', ts: 1 });
      mod.beginAdapterLogRecording({
        source: 'simulator',
        simulatedVehicleId: 'fiat-punto-2008-12',
      });
      expect(mod.adapterLogSnapshot()).toEqual([]);
      expect(mod.adapterLogOrigin()).toEqual({
        source: 'simulator',
        simulatedVehicleId: 'fiat-punto-2008-12',
      });
      mod.appendAdapterLog({ dir: 'tx', text: 'ATZ', ts: 2 });
      mod.beginAdapterLogRecording({ source: 'car' });
      expect(mod.adapterLogSnapshot()).toEqual([]);
      expect(mod.adapterLogOrigin()).toEqual({ source: 'car' });
    });

    it('a connect to another BLE adapter clears the log first', () => {
      const mod = fresh();
      mod.beginAdapterLogRecording({ source: 'car', deviceId: 'AA:01' });
      mod.appendAdapterLog({ dir: 'tx', text: 'ATZ', ts: 1 });
      mod.noteAdapterLogLink({ adapter: 'ELM327 v1.5', protocol: 'ISO_15765_4_CAN_11_500' });
      mod.beginAdapterLogRecording({ source: 'car', deviceId: 'BB:02' });
      expect(mod.adapterLogSnapshot()).toEqual([]);
      expect(mod.adapterLogOrigin()).toEqual({ source: 'car', deviceId: 'BB:02' });
    });

    it('a reconnect on the same adapter to another car keeps only the new car’s traffic', () => {
      const mod = fresh();
      const CAR = { source: 'car' as const, deviceId: 'AA:01' };
      mod.beginAdapterLogRecording(CAR);
      mod.appendAdapterLog({ dir: 'tx', text: 'golf', ts: 1 });
      mod.noteAdapterLogLink({
        adapter: 'v1.5',
        protocol: 'ISO_15765_4_CAN_11_500',
        vin: 'WVWZZZ1KZ9W000001',
      });
      mod.beginAdapterLogRecording(CAR);
      mod.appendAdapterLog({ dir: 'tx', text: 'punto', ts: 2 });
      mod.noteAdapterLogLink({
        adapter: 'v1.5',
        protocol: 'ISO_14230_4_KWP_FAST',
        vin: 'ZFA19900000000001',
      });
      expect(mod.adapterLogSnapshot().map((e) => e.text)).toEqual(['punto']);
      expect(mod.adapterLogOrigin()).toEqual({
        ...CAR,
        adapter: 'v1.5',
        protocol: 'ISO_14230_4_KWP_FAST',
        vin: 'ZFA19900000000001',
      });
      expect(mod.useAdapterLogStore.getState().entries.map((e) => e.text)).toEqual(['punto']);
    });

    it('without a VIN, another negotiated protocol marks another car; the same car keeps its log', () => {
      const mod = fresh();
      const CAR = { source: 'car' as const, deviceId: 'AA:01' };
      mod.beginAdapterLogRecording(CAR);
      mod.appendAdapterLog({ dir: 'tx', text: 'a', ts: 1 });
      mod.noteAdapterLogLink({ protocol: 'ISO_15765_4_CAN_11_500' });
      mod.beginAdapterLogRecording(CAR);
      mod.appendAdapterLog({ dir: 'tx', text: 'b', ts: 2 });
      mod.noteAdapterLogLink({ protocol: 'ISO_15765_4_CAN_11_500' });
      expect(mod.adapterLogSnapshot().map((e) => e.text)).toEqual(['a', 'b']);
      mod.beginAdapterLogRecording(CAR);
      mod.appendAdapterLog({ dir: 'tx', text: 'c', ts: 3 });
      mod.noteAdapterLogLink({ protocol: 'ISO_9141_2' });
      expect(mod.adapterLogSnapshot().map((e) => e.text)).toEqual(['c']);
    });

    it('dropping the previous car’s traffic leaves the wrap count of the new session only', () => {
      const mod = fresh();
      const CAR = { source: 'car' as const, deviceId: 'AA:01' };
      mod.beginAdapterLogRecording(CAR);
      for (let i = 0; i < 10; i++) mod.appendAdapterLog({ dir: 'tx', text: `old${i}`, ts: i });
      mod.noteAdapterLogLink({ vin: 'VIN-A' });
      mod.beginAdapterLogRecording(CAR);
      const extra = 5;
      for (let i = 0; i < mod.ADAPTER_LOG_CAPACITY + extra; i++)
        mod.appendAdapterLog({ dir: 'rx', text: `new${i}`, ts: 100 + i });
      mod.noteAdapterLogLink({ vin: 'VIN-B' });
      const snap = mod.adapterLogSnapshot();
      expect(snap).toHaveLength(mod.ADAPTER_LOG_CAPACITY);
      expect(snap[0].text).toBe(`new${extra}`);
      expect(mod.useAdapterLogStore.getState().dropped).toBe(extra);
    });

    it('clear drops the origin with the entries', () => {
      const mod = fresh();
      mod.beginAdapterLogRecording(SIM_GOLF);
      mod.clearAdapterLog();
      expect(mod.adapterLogOrigin()).toBeNull();
      expect(mod.useAdapterLogStore.getState().origin).toBeNull();
      // A link reported with no recording in progress stamps nothing.
      mod.noteAdapterLogLink({ adapter: 'x' });
      expect(mod.adapterLogOrigin()).toBeNull();
    });

    it('Settings’ Clear drops the entries but keeps the recording’s origin', () => {
      const mod = fresh();
      mod.beginAdapterLogRecording(SIM_GOLF);
      mod.appendAdapterLog({ dir: 'tx', text: 'ATZ', ts: 1 });
      mod.noteAdapterLogLink({ adapter: 'ELM327 v2.2', protocol: 'ISO_15765_4_CAN_11_500' });
      mod.clearAdapterLogEntries();
      expect(mod.adapterLogSnapshot()).toEqual([]);
      expect(mod.useAdapterLogStore.getState().entries).toEqual([]);
      const want = { ...SIM_GOLF, adapter: 'ELM327 v2.2', protocol: 'ISO_15765_4_CAN_11_500' };
      expect(mod.adapterLogOrigin()).toEqual(want);
      expect(mod.useAdapterLogStore.getState().origin).toEqual(want);
      // The next flow on the same session is still the Golf's; a connect to another car after the
      // Clear starts its own recording.
      mod.appendAdapterLog({ dir: 'tx', text: '03', ts: 2 });
      mod.beginAdapterLogRecording({
        source: 'simulator',
        simulatedVehicleId: 'fiat-punto-2008-12',
      });
      expect(mod.adapterLogSnapshot()).toEqual([]);
      expect(mod.adapterLogOrigin()).toEqual({
        source: 'simulator',
        simulatedVehicleId: 'fiat-punto-2008-12',
      });
    });

    it('a connect clears traffic no connect stamped, so an unknown log never joins a recording', () => {
      const mod = fresh();
      mod.appendAdapterLog({ dir: 'tx', text: 'ATZ', ts: 1 });
      expect(mod.adapterLogOrigin()).toBeNull();
      mod.beginAdapterLogRecording(SIM_GOLF);
      expect(mod.adapterLogSnapshot()).toEqual([]);
      expect(mod.adapterLogOrigin()).toEqual(SIM_GOLF);
    });
  });
});
