/** Adapter-source switching (plan 01 review): a simulator session — connected or still connecting —
 *  must never survive a switch to the real adapter. Runs the real connectionService against the
 *  MockTransport; the BLE modules (react-native / ble-plx) and the file system are mocked out. */
const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    files.delete(uri);
  }),
}));
jest.mock('@/shared/transports/ble/BleTransport', () => ({ BleTransport: jest.fn() }));
jest.mock('@/shared/transports/ble/manager', () => ({ getBleManager: jest.fn() }));
jest.mock('@/shared/transports/ble/permissions', () => ({
  requestBlePermissions: jest.fn(async () => false),
}));

import * as scenarios from '@/shared/obd-core/transport/scenarios';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { adapterLogOrigin, adapterLogSnapshot, clearAdapterLog } from '@/shared/state/adapterLog';
import {
  __sim,
  connect,
  disconnect,
  FLAP_PAUSED_MESSAGE,
  resetForRestore,
  switchAdapterSource,
  switchToRealAdapter,
} from './connectionService';
import { diagnoseFailure } from './diagnoseFailure';
import { useLinkStore } from '../model/linkStore';

beforeEach(async () => {
  await disconnect();
  useSettingsStore.setState({ adapterSource: 'mock', injectedDtcs: [] });
});

afterAll(async () => {
  await disconnect();
});

describe('switchToRealAdapter', () => {
  it('tears down a connected simulator session', async () => {
    await connect();
    expect(useSessionStore.getState().status).toBe('connected');
    expect(useSessionStore.getState().deviceId).toBe('mock');

    await switchToRealAdapter();
    const s = useSessionStore.getState();
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(s.status).toBe('disconnected');
    expect(s.session).toBeNull();
    expect(s.deviceId).toBeNull();
  });

  it('drops a simulator connect that is still in flight instead of publishing it', async () => {
    const pending = connect();
    expect(['connecting', 'initializing']).toContain(useSessionStore.getState().status);

    await switchToRealAdapter();
    await pending;
    const s = useSessionStore.getState();
    expect(useSettingsStore.getState().adapterSource).toBe('ble');
    expect(s.status).toBe('disconnected');
    expect(s.session).toBeNull();
    expect(s.error).toBeNull();
  });
});

describe('switchAdapterSource', () => {
  it('is a no-op when the source is unchanged', async () => {
    await connect();
    await switchAdapterSource('mock');
    expect(useSessionStore.getState().status).toBe('connected');
  });

  it('clears the adapter log, so a simulator log is never exported under the real adapter', async () => {
    await connect();
    expect(adapterLogSnapshot().length).toBeGreaterThan(0);
    await switchAdapterSource('ble');
    expect(adapterLogSnapshot()).toEqual([]);
  });

  it('a connect superseded by a switch logs nothing after the switch', async () => {
    const pending = connect();
    await switchAdapterSource('ble');
    await pending;
    expect(adapterLogSnapshot()).toEqual([]);
  });

  it('a connect started after the switch is unaffected', async () => {
    await switchAdapterSource('ble');
    await switchAdapterSource('mock');
    await connect();
    expect(useSessionStore.getState().status).toBe('connected');
  });
});

describe('adapter log origin (plan W2)', () => {
  it('stamps the simulator session that recorded the log, link details included', async () => {
    clearAdapterLog();
    await connect();
    expect(adapterLogOrigin()).toEqual({
      source: 'simulator',
      simulatedVehicleId: useSettingsStore.getState().simulatedVehicleId,
      adapter: 'ELM327 v2.2',
      protocol: useSessionStore.getState().info?.protocol,
      vin: useSessionStore.getState().info?.vin ?? undefined,
    });
    // A disconnect keeps the log and how it was recorded.
    await disconnect();
    expect(adapterLogSnapshot().length).toBeGreaterThan(0);
    expect(adapterLogOrigin()?.adapter).toBe('ELM327 v2.2');
  });

  it('a connect to another simulated car clears the previous car’s log first', async () => {
    clearAdapterLog();
    useSettingsStore.setState({ simulatedVehicleId: 'golf-plus-2009-20tdi' });
    await connect();
    await disconnect();
    useSettingsStore.setState({ simulatedVehicleId: 'fiat-punto-2008-12' });
    const pending = connect();
    // Cleared before the Punto's first command went out: nothing of the Golf's session is left.
    expect(adapterLogSnapshot()).toEqual([]);
    expect(adapterLogOrigin()?.simulatedVehicleId).toBe('fiat-punto-2008-12');
    await pending;
    expect(adapterLogSnapshot().some((e) => e.text === 'ATZ')).toBe(true);
  });
});

describe('resetForRestore (plan 18)', () => {
  it('tears down a connected session and clears the adapter log', async () => {
    await connect();
    expect(adapterLogSnapshot().length).toBeGreaterThan(0);
    await resetForRestore();
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.session).toBeNull();
    expect(adapterLogSnapshot()).toEqual([]);
  });

  it('drops a connect still in flight, so a restored source never inherits its session', async () => {
    const pending = connect();
    expect(useSessionStore.getState().session).toBeNull();
    await resetForRestore();
    // what a restored bolid.settings does behind the service's back
    useSettingsStore.setState({ adapterSource: 'ble' });
    await pending;
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.session).toBeNull();
    expect(adapterLogSnapshot()).toEqual([]);
  });
});

describe('auto-reconnect flap guard (plan 12)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useSettingsStore.setState({ autoReconnect: true });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Run a connect to completion under fake timers (the simulator answers on setTimeout(0)). */
  async function settle<T>(p: Promise<T>): Promise<T> {
    await jest.advanceTimersByTimeAsync(500);
    return p;
  }

  /** Drop the live simulator link and let the backoff (2 s) reconnect it if it is going to. */
  async function dropAndWait(): Promise<void> {
    expect(__sim.simulateDrop()).toBe(true);
    await jest.advanceTimersByTimeAsync(3000);
  }

  it('reconnects on its own after a drop, and pauses on the third drop in a minute', async () => {
    await settle(connect());
    expect(useSessionStore.getState().status).toBe('connected');

    await dropAndWait();
    expect(useSessionStore.getState().status).toBe('connected'); // reconnected, toggle untouched
    await dropAndWait();
    expect(useSessionStore.getState().status).toBe('connected');

    expect(__sim.simulateDrop()).toBe(true); // third drop inside 60 s
    await jest.advanceTimersByTimeAsync(20_000);
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.error).toBe(FLAP_PAUSED_MESSAGE);
  });

  it('a manual connect resets the flap guard', async () => {
    await settle(connect());
    await dropAndWait();
    await dropAndWait();
    await settle(connect()); // the user reconnects by hand
    await dropAndWait();
    expect(useSessionStore.getState().status).toBe('connected'); // reconnected again, not paused
  });

  it('drops spread over more than a minute never pause it', async () => {
    await settle(connect());
    for (let i = 0; i < 4; i++) {
      await dropAndWait();
      expect(useSessionStore.getState().status).toBe('connected');
      await jest.advanceTimersByTimeAsync(31_000);
    }
  });

  it('does nothing with auto-reconnect off', async () => {
    useSettingsStore.setState({ autoReconnect: false });
    await settle(connect());
    await dropAndWait();
    expect(useSessionStore.getState().status).toBe('disconnected');
  });

  it('ends in error (diagnostics panel up) with the last cause when every attempt fails', async () => {
    await settle(connect());
    // Every reconnect attempt fails while building the simulator (as a vanished adapter would).
    const spy = jest.spyOn(scenarios, 'buildScenario').mockImplementation(() => {
      throw new Error('ELM327 timeout after 5000ms for "ATZ"');
    });
    try {
      expect(__sim.simulateDrop()).toBe(true);
      await jest.advanceTimersByTimeAsync(20_000);
      const s = useSessionStore.getState();
      expect(s.status).toBe('error');
      expect(s.error).toMatch(/Auto-reconnect failed after 3 attempts/);
      expect(s.error).toMatch(/Last error: .*timeout.*"ATZ"/);
    } finally {
      spy.mockRestore();
    }
  });

  it('simulateDrop is a no-op without a live simulator session', () => {
    expect(__sim.simulateDrop()).toBe(false);
  });
});

describe('simulator "fail next connect" (plan 12)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives no reply to ATZ once, and the diagnostics classify it as stage init', async () => {
    __sim.failNextConnect();
    expect(__sim.isFailNextConnectArmed()).toBe(true);
    const failing = connect().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(6000);
    const err = await failing;
    expect(err).toBeInstanceOf(Error);
    expect(__sim.isFailNextConnectArmed()).toBe(false);
    const s = useSessionStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/timeout.*ATZ/);

    const since = useLinkStore.getState().attemptStartedAt ?? 0;
    const logTail = adapterLogSnapshot()
      .filter((e) => e.ts >= since)
      .slice(-20);
    const d = diagnoseFailure({
      error: s.error,
      btState: 'checking',
      adapterSource: 'mock',
      logTail,
      deviceName: null,
    });
    expect(d.stage).toBe('init');
    expect(d.explanation).toMatch(/unpowered or asleep/);
    expect(useLinkStore.getState().stage).toBe('init'); // the transport did come up
    // The failed attempt's device is recorded even though setConnected never ran.
    expect(s.deviceId).toBeNull();
    expect(useLinkStore.getState().device).toEqual({
      id: 'mock',
      name: expect.stringMatching(/^Simulator · /),
    });

    // One-shot: the next connect works, and reaches the last stage.
    const ok = connect();
    await jest.advanceTimersByTimeAsync(500);
    await ok;
    expect(useSessionStore.getState().status).toBe('connected');
    expect(useLinkStore.getState().stage).toBe('identify');
  });

  it('records the furthest stage as probe when the car does not answer 0100', async () => {
    // The adapter answers its AT set-up, but the car never answers the first OBD2 request (0100).
    const realConnect = MockTransport.prototype.connect;
    const spy = jest.spyOn(MockTransport.prototype, 'connect').mockImplementation(async function (
      this: MockTransport,
    ) {
      await realConnect.call(this);
      this.dropResponses(1);
    });
    try {
      const failing = connect().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(20_000);
      expect(await failing).toBeInstanceOf(Error);
      expect(useSessionStore.getState().error).toMatch(/vehicle isn’t responding/);
      expect(useLinkStore.getState().stage).toBe('probe');
    } finally {
      spy.mockRestore();
    }
  });
});
