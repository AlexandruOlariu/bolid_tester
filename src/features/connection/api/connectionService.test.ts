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
  requestClassicBluetoothPermissions: jest.fn(async () => false),
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
  listPairedAdapters,
  setSppModuleLoader,
  setTcpSocketFactory,
  setWebBluetooth,
  chooseWebAdapterAndConnect,
  switchAdapterSource,
  switchToRealAdapter,
} from './connectionService';
import { bridgeToMock } from '@/shared/obd-core/transport/testing/bridge';
import { FakeSocket, socketOverBridge } from '@/shared/transports/tcp/testing/fakeSocket';
import { DEFAULT_WIFI_ENDPOINT } from '@/shared/transports/tcp/endpoint';
import {
  FakeSppModule,
  sppDeviceOverBridge,
  type FakeSppDevice,
} from '@/shared/transports/spp/testing/fakeSppModule';
import {
  requestBlePermissions,
  requestClassicBluetoothPermissions,
} from '@/shared/transports/ble/permissions';
import { MONITOR_UNAVAILABLE_MESSAGE } from '@/shared/obd-core/transport/Transport';
import {
  FakeWebBluetooth,
  namedError,
  webDeviceOverBridge,
  type FakeWebBtDevice,
} from '@/shared/transports/web-ble/testing/fakeWebBluetooth';
import { getBleManager } from '@/shared/transports/ble/manager';
import { hideToast, useToastStore } from '@/shared/state/toastStore';
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

describe('Wi-Fi adapter (plan 26)', () => {
  let sockets: FakeSocket[] = [];
  /** Every Wi-Fi connect plays the simulated Golf through the test bridge. */
  const bridgedGolf = async () => {
    const socket = socketOverBridge(bridgeToMock(scenarios.buildScenario('golf-plus-2009-20tdi')));
    sockets.push(socket);
    return socket;
  };

  beforeEach(() => {
    sockets = [];
    useSettingsStore.setState({
      adapterSource: 'wifi',
      wifi: { ...DEFAULT_WIFI_ENDPOINT },
      autoReconnect: false,
    });
  });
  afterEach(() => {
    setTcpSocketFactory(undefined);
    jest.useRealTimers();
    useSettingsStore.setState({ autoReconnect: true });
  });

  it('connects over TCP to the endpoint from settings and publishes the session', async () => {
    setTcpSocketFactory(bridgedGolf);
    await connect();
    const s = useSessionStore.getState();
    expect(s.status).toBe('connected');
    expect(s.deviceId).toBe('192.168.0.10:35000');
    expect(s.deviceName).toBe('Wi-Fi ELM327');
    expect(s.info?.protocol).toBe('ISO_15765_4_CAN_11_500');
    expect(useLinkStore.getState().kind).toBe('wifi');
    expect(useLinkStore.getState().link).toBeNull(); // no BLE link facts for a socket
    expect(adapterLogOrigin()).toMatchObject({ source: 'car', deviceId: '192.168.0.10:35000' });
    expect(adapterLogSnapshot().some((e) => e.dir === 'tx' && /ATZ/.test(e.text))).toBe(true);

    await disconnect();
    expect(sockets[0].destroyed).toBe(1);
    expect(useSessionStore.getState().status).toBe('disconnected');
  });

  it('a refused connection ends in error with the join-the-network diagnosis', async () => {
    setTcpSocketFactory(async () => {
      const socket = new FakeSocket();
      setTimeout(() => socket.emitError(new Error('connect ECONNREFUSED 192.168.0.10:35000')), 0);
      return socket;
    });
    await expect(connect()).rejects.toThrow(/Could not reach the Wi-Fi adapter/);
    const s = useSessionStore.getState();
    expect(s.status).toBe('error');
    expect(useLinkStore.getState().stage).toBe('transport');
    expect(useLinkStore.getState().device).toEqual({
      id: '192.168.0.10:35000',
      name: 'Wi-Fi ELM327',
    });
    const d = diagnoseFailure({
      error: s.error,
      btState: 'checking',
      adapterSource: 'wifi',
      logTail: [],
      deviceName: 'Wi-Fi ELM327',
    });
    expect(d.explanation).toMatch(/not on the adapter’s Wi-Fi network/);
  });

  it('no adapter on the network: fails within 5 s', async () => {
    jest.useFakeTimers();
    setTcpSocketFactory(async () => new FakeSocket()); // never connects
    const failing = connect().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(4999);
    expect(useSessionStore.getState().status).not.toBe('error');
    await jest.advanceTimersByTimeAsync(1);
    expect(await failing).toBeInstanceOf(Error);
    expect(useSessionStore.getState().status).toBe('error');
    expect(useSessionStore.getState().error).toMatch(/within 5 s \(ETIMEDOUT\)/);
  });

  it('an unsolicited socket close is handled as a link loss', async () => {
    setTcpSocketFactory(bridgedGolf);
    await connect();
    sockets[0].emitClose();
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.error).toMatch(/Adapter link lost/);
  });
});

describe('Classic Bluetooth adapter (plan 27)', () => {
  const ADDR = '00:1D:A5:68:98:8B';
  let devices: FakeSppDevice[] = [];
  let mod: FakeSppModule;
  const permissions = requestClassicBluetoothPermissions as jest.Mock;
  const blePermissions = requestBlePermissions as jest.Mock;

  beforeEach(() => {
    devices = [];
    // Every SPP connect plays the simulated Golf through the bridge, chunked by `>` like the library.
    mod = new FakeSppModule(() => {
      const device = sppDeviceOverBridge(
        bridgeToMock(scenarios.buildScenario('golf-plus-2009-20tdi')),
      );
      devices.push(device);
      return device;
    });
    setSppModuleLoader(async () => mod);
    permissions.mockResolvedValue(true);
    useSettingsStore.setState({ adapterSource: 'spp', autoReconnect: false });
  });
  afterEach(() => {
    setSppModuleLoader(undefined);
    permissions.mockResolvedValue(false);
    useSettingsStore.setState({ autoReconnect: true });
  });

  it('connects to the paired adapter and publishes a session that cannot sniff', async () => {
    await connect({ deviceId: ADDR, deviceName: 'OBDII' });
    const s = useSessionStore.getState();
    expect(s.status).toBe('connected');
    expect(s.deviceId).toBe(ADDR);
    expect(s.deviceName).toBe('OBDII');
    expect(s.info?.protocol).toBe('ISO_15765_4_CAN_11_500');
    expect(mod.connects[0]).toEqual({ address: ADDR, opts: { delimiter: '>', charset: 'ascii' } });
    expect(useLinkStore.getState().kind).toBe('spp');
    expect(adapterLogOrigin()).toMatchObject({ source: 'car', deviceId: ADDR });
    // The adapter-log wrapper forwards the transport's capabilities to the session.
    expect(s.session?.canMonitor).toBe(false);
    await expect(s.session!.startSniffer(() => undefined)).rejects.toThrow(
      MONITOR_UNAVAILABLE_MESSAGE,
    );

    await disconnect();
    expect(devices[0].disconnects).toBe(1);
    expect(useSessionStore.getState().status).toBe('disconnected');
  });

  it('a nameless paired device connects under a readable name', async () => {
    await connect({ deviceId: ADDR });
    expect(useSessionStore.getState().deviceName).toBe('Classic Bluetooth adapter');
  });

  it('refuses without a picked device or without the Bluetooth permission', async () => {
    await expect(connect()).rejects.toThrow('Select a paired adapter first');
    permissions.mockResolvedValueOnce(false);
    await expect(connect({ deviceId: ADDR })).rejects.toThrow('Bluetooth permission denied');
    expect(mod.connects).toHaveLength(0);
    // Only the Classic Bluetooth permission is asked — never the BLE (location on old Android) one.
    expect(blePermissions).not.toHaveBeenCalled();
  });

  it('a socket failure ends in error with the paired-but-not-reachable diagnosis', async () => {
    setSppModuleLoader(
      async () =>
        new FakeSppModule(() => {
          throw new Error('read failed, socket might closed or timeout, read ret: -1');
        }),
    );
    await expect(connect({ deviceId: ADDR, deviceName: 'OBDII' })).rejects.toThrow(
      /Could not open the Classic Bluetooth adapter/,
    );
    const s = useSessionStore.getState();
    expect(s.status).toBe('error');
    expect(useLinkStore.getState().stage).toBe('transport');
    expect(useLinkStore.getState().device).toEqual({ id: ADDR, name: 'OBDII' });
    const d = diagnoseFailure({
      error: s.error,
      btState: 'checking',
      adapterSource: 'spp',
      logTail: [],
      deviceName: 'OBDII',
    });
    expect(d.explanation).toBe('The adapter is paired but not reachable.');
  });

  it('the adapter going away is handled as a link loss', async () => {
    await connect({ deviceId: ADDR });
    mod.emitDisconnected(ADDR);
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.error).toMatch(/Adapter link lost/);
  });

  it('only the RFCOMM socket closing (Bluetooth link still up) is a link loss too', async () => {
    await connect({ deviceId: ADDR });
    mod.emitSocketClosed(ADDR);
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.error).toMatch(/Adapter link lost/);
  });

  it('auto-reconnect replays the paired address', async () => {
    jest.useFakeTimers();
    try {
      useSettingsStore.setState({ autoReconnect: true });
      // The simulator answers on setTimeout(0): advance the fake clock to finish each connect.
      const first = connect({ deviceId: ADDR, deviceName: 'OBDII' });
      await jest.advanceTimersByTimeAsync(500);
      await first;
      mod.emitDisconnected(ADDR);
      expect(useSessionStore.getState().status).toBe('disconnected');
      await jest.advanceTimersByTimeAsync(3000); // the 2 s backoff, then the reconnect itself
      expect(mod.connects.map((c) => c.address)).toEqual([ADDR, ADDR]);
      expect(useSessionStore.getState().status).toBe('connected');
      expect(useSessionStore.getState().deviceName).toBe('OBDII');
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists the paired devices, likely adapters first', async () => {
    mod.bonded = [
      { address: '11:11:11:11:11:11', name: 'Headphones' },
      { address: ADDR, name: 'OBDII' },
    ];
    const list = await listPairedAdapters();
    expect(list.map((d) => d.name)).toEqual(['OBDII', 'Headphones']);
    expect(list[0].isLikelyAdapter).toBe(true);
  });
});

describe('Web Bluetooth adapter (plan 28)', () => {
  let device: FakeWebBtDevice;
  let bt: FakeWebBluetooth;
  const blePermissions = requestBlePermissions as jest.Mock;

  beforeEach(() => {
    device = webDeviceOverBridge(bridgeToMock(scenarios.buildScenario('golf-plus-2009-20tdi')));
    bt = new FakeWebBluetooth(device);
    setWebBluetooth(bt);
    useSettingsStore.setState({ adapterSource: 'ble', autoReconnect: false });
  });
  afterEach(() => {
    setWebBluetooth(undefined);
    useSettingsStore.setState({ autoReconnect: true });
  });

  it('opens the chooser, connects to the pick over GATT and publishes the session', async () => {
    await expect(chooseWebAdapterAndConnect()).resolves.toBe(true);
    expect(bt.requests).toHaveLength(1);
    const s = useSessionStore.getState();
    expect(s.status).toBe('connected');
    expect(s.deviceId).toBe('web-ble-golf');
    expect(s.deviceName).toBe('IOS-Vlink');
    expect(s.info?.protocol).toBe('ISO_15765_4_CAN_11_500');
    // Never the native stack: no runtime permission prompt, no BleManager.
    expect(blePermissions).not.toHaveBeenCalled();
    expect(getBleManager).not.toHaveBeenCalled();
    const link = useLinkStore.getState();
    expect(link.kind).toBe('ble');
    expect(link.link).toMatchObject({ mtu: 23, payload: 20, writeWithoutResponse: true });
    expect(s.session?.canMonitor).toBe(true);

    await disconnect();
    expect(device.gatt.connected).toBe(false);
    expect(useSessionStore.getState().status).toBe('disconnected');
  });

  it('a cancelled chooser leaves the app disconnected with a plain-English message', async () => {
    bt.error = namedError('NotFoundError', 'User cancelled the requestDevice() chooser.');
    await expect(chooseWebAdapterAndConnect()).resolves.toBe(false);
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.error).toMatch(/^No adapter was chosen/);
    expect(device.gatt.connectCalls).toBe(0);
  });

  it('a cancelled chooser after a failed attempt closes the old diagnostics (error → disconnected)', async () => {
    device.gatt.failConnect = namedError('NetworkError', 'Connection failed for unknown reason.');
    await expect(chooseWebAdapterAndConnect()).rejects.toMatchObject({ name: 'NetworkError' });
    expect(useSessionStore.getState().status).toBe('error');
    bt.error = namedError('NotFoundError', 'User cancelled the requestDevice() chooser.');
    await expect(chooseWebAdapterAndConnect()).resolves.toBe(false);
    const s = useSessionStore.getState();
    expect(s.status).toBe('disconnected');
    expect(s.error).toMatch(/^No adapter was chosen/);
  });

  it('a cancelled chooser while connected leaves the live session alone (toast only)', async () => {
    await expect(chooseWebAdapterAndConnect()).resolves.toBe(true);
    const session = useSessionStore.getState().session;
    bt.error = namedError('NotFoundError', 'User cancelled the requestDevice() chooser.');
    await expect(chooseWebAdapterAndConnect()).resolves.toBe(false);
    const s = useSessionStore.getState();
    expect(s.status).toBe('connected');
    expect(s.session).toBe(session);
    expect(s.error).toBeNull();
    expect(useToastStore.getState().toast?.message).toMatch(/^No adapter was chosen/);
    hideToast();
    await disconnect();
  });

  it('a cancelled chooser while a session is initializing leaves it alone (toast only)', async () => {
    // e.g. an auto-reconnect in its init / probe stage: the button is enabled (useConnect is idle).
    useSessionStore.getState().setStatus('initializing');
    useSessionStore.getState().setError('Reconnecting to the adapter… attempt 1 of 3.');
    bt.error = namedError('NotFoundError', 'User cancelled the requestDevice() chooser.');
    await expect(chooseWebAdapterAndConnect()).resolves.toBe(false);
    const s = useSessionStore.getState();
    expect(s.status).toBe('initializing');
    expect(s.error).toBe('Reconnecting to the adapter… attempt 1 of 3.');
    expect(useToastStore.getState().toast?.message).toMatch(/^No adapter was chosen/);
    hideToast();
    useSessionStore.getState().setStatus('disconnected');
    useSessionStore.getState().setError(null);
  });

  it('a browser without Web Bluetooth explains which browsers work', async () => {
    setWebBluetooth(null);
    await expect(chooseWebAdapterAndConnect()).resolves.toBe(false);
    expect(useSessionStore.getState().error).toMatch(/Chrome or Edge/);
  });

  it('a GATT failure ends in error with the browser error explained', async () => {
    device.gatt.failConnect = namedError('NetworkError', 'Connection failed for unknown reason.');
    await expect(chooseWebAdapterAndConnect()).rejects.toMatchObject({ name: 'NetworkError' });
    const s = useSessionStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/^Could not open the Bluetooth link to the adapter/);
    expect(useLinkStore.getState().device).toEqual({ id: 'web-ble-golf', name: 'IOS-Vlink' });
  });

  it('the adapter going away is a link loss, and auto-reconnect reopens the same device', async () => {
    jest.useFakeTimers();
    try {
      useSettingsStore.setState({ autoReconnect: true });
      const first = chooseWebAdapterAndConnect();
      await jest.advanceTimersByTimeAsync(500);
      await first;
      device.dropLink();
      expect(useSessionStore.getState().status).toBe('disconnected');
      expect(useSessionStore.getState().error).toMatch(/Adapter link lost/);
      await jest.advanceTimersByTimeAsync(3000);
      expect(useSessionStore.getState().status).toBe('connected');
      // Reconnected through the picked device: no second chooser (it would need a user gesture).
      expect(bt.requests).toHaveLength(1);
      expect(device.gatt.connectCalls).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
