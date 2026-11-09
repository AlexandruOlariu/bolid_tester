/** The connection feature's service layer: builds the right Transport (simulator, BLE — native, or
 *  Web Bluetooth in the browser, plan 28 — Wi-Fi TCP — plan 26 — or Classic Bluetooth SPP — plan
 *  27), wires the adapter I/O log, runs the DiagnosticSession, and updates the shared stores.
 *  Note: "api" here means device/engine access, not a network API.
 *
 *  It also owns the *link-loss lifecycle*: once connected it watches the transport's status events
 *  and, on an unsolicited drop, flips the app to disconnected (instead of letting every later
 *  command time out) and — when auto-reconnect is on (the default) — drives auto-reconnect with
 *  backoff, paused by the flap guard after 3 drops in a minute (plan 12). */

import { Transport, TransportStatus } from '@/shared/obd-core/transport/Transport';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { DEFAULT_WAKE_AFTER_IDLE_MS } from '@/shared/obd-core/elm327/Elm327Client';
import { logRxText, logTxText } from '@/shared/obd-core/transport/recordingTransport';
import { BleTransport } from '@/shared/transports/ble/BleTransport';
import { getBleManager } from '@/shared/transports/ble/manager';
import {
  requestBlePermissions,
  requestClassicBluetoothPermissions,
} from '@/shared/transports/ble/permissions';
import { TcpTransport, type TcpSocketFactory } from '@/shared/transports/tcp/TcpTransport';
import { formatEndpoint } from '@/shared/transports/tcp/endpoint';
import {
  WebBluetoothTransport,
  describeWebBluetoothError,
  getWebBluetooth,
  type WebBluetoothLike,
  type WebBtDevice,
} from '@/shared/transports/web-ble/WebBluetoothTransport';
import {
  SppTransport,
  listBondedAdapters,
  type BondedAdapter,
  type SppModuleLoader,
} from '@/shared/transports/spp/SppTransport';
import { useSettingsStore, type AdapterSource } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { simulatorSourceFor } from '@/shared/vehicles/resolve';
import { isCan } from '@/shared/obd-core/obd/protocols';
import { getActiveProfile } from '@/shared/state/activeProfile';
import {
  appendAdapterLog,
  beginAdapterLogRecording,
  clearAdapterLog,
  noteAdapterLogLink,
} from '@/shared/state/adapterLog';
import { logError } from '@/shared/state/errorLogStore';
import { showToast } from '@/shared/state/toastStore';
import { runReconnect, RECONNECT_DELAYS_MS } from './reconnect';
import { pruneDrops, shouldAutoReconnect } from './flapGuard';
import { useLinkStore, type AttemptDevice } from '../model/linkStore';

/** Tap the transport to mirror every command/response into the adapter I/O log (a throttled ring
 *  buffer — see adapterLog.ts).
 *
 *  `isMonitoring` reports whether the ELM client is currently in monitor mode (`ATMA` sniff). While
 *  monitoring we do NOT mirror rx chunks: the sniffer feature has its own line listener on that same
 *  firehose, so logging here would double-handle hundreds of frames per second for no benefit
 *  (finding F5). tx commands are always logged — there are only a couple during a sniff (the ATMA
 *  and the stop).
 *
 *  The text normalisation is obd-core's (`logTxText` / `logRxText`, shared with
 *  `RecordingTransport`): rx chunks keep their line breaks as `\r`, so an exported replay fixture
 *  can still tell several ECUs' answers and ISO-TP segment lines apart.
 *
 *  `isStale` reports that the adapter source was switched since this transport's connect began
 *  (`connectEpoch`). A superseded link logs nothing more, so the log — cleared on every switch —
 *  only ever holds traffic from the current source, and a replay fixture exported from it is
 *  labelled correctly (`meta.source`, plan 02 review). */
function withLog(inner: Transport, isMonitoring: () => boolean, isStale: () => boolean): Transport {
  return {
    get status() {
      return inner.status;
    },
    // Forwarded, so the session sees what the real link can do (no ATMA over SPP, plan 27).
    get capabilities() {
      return inner.capabilities;
    },
    connect: () => inner.connect(),
    disconnect: () => inner.disconnect(),
    write: (bytes) => {
      if (!isStale()) appendAdapterLog({ dir: 'tx', text: logTxText(bytes), ts: Date.now() });
      return inner.write(bytes);
    },
    onData: (listener) =>
      inner.onData((bytes) => {
        if (!isMonitoring() && !isStale())
          appendAdapterLog({ dir: 'rx', text: logRxText(bytes), ts: Date.now() });
        listener(bytes);
      }),
    onStatusChange: (listener) => inner.onStatusChange(listener),
  };
}

export interface ConnectTarget {
  deviceId: string;
  deviceName?: string;
  /** The device picked in the browser's Web Bluetooth chooser (web build, plan 28). Kept on the
   *  target so auto-reconnect reopens the same device without a new chooser (which would need a
   *  user gesture). */
  webDevice?: WebBtDevice;
}

const LINK_LOST_MESSAGE =
  'Adapter link lost — the connection dropped unexpectedly. Check the adapter is seated in the ' +
  'OBD2 port and reconnect.';

/** Shown when the flap guard pauses auto-reconnect (see flapGuard.ts). */
export const FLAP_PAUSED_MESSAGE =
  'The link dropped 3 times in a minute — auto-reconnect paused. Check the adapter is seated and ' +
  'reconnect manually.';

// --- Link-loss + auto-reconnect state (module-level, single active connection) -------------------

/** Unsubscribe for the status watcher on the live transport, or null when nothing is watched. */
let statusUnsub: (() => void) | null = null;
/** The last connect target, replayed by auto-reconnect (undefined for the simulator). */
let lastTarget: ConnectTarget | undefined;
/** The in-flight auto-reconnect run, if any. `cancelSleep` wakes a pending backoff wait early. */
let reconnectRun: { aborted: boolean; cancelSleep: () => void } | null = null;
/** Bumped by every adapter-source switch. A connect that started under an older epoch is stale: it
 *  was built for the previous source (e.g. a MockTransport), so it must never publish its session. */
let connectEpoch = 0;
/** Timestamps of recent unsolicited drops, for the flap guard. Reset by a manual connect. */
let dropsAt: number[] = [];
/** The un-wrapped transport of the live session (for the simulator dev hooks), or null. */
let liveRawTransport: Transport | null = null;
/** Simulator dev hook: the next simulator connect gets no reply to `ATZ` (see `__sim`). */
let failNextSimConnect = false;
/** The socket factory Wi-Fi connects use; undefined = `react-native-tcp-socket` (the app). */
let tcpSocketFactory: TcpSocketFactory | undefined;

/** Test seam (plan 26): open Wi-Fi sockets with `factory` instead of `react-native-tcp-socket`, so
 *  the Wi-Fi connect path runs under Jest against a fake socket. `undefined` restores the default. */
export function setTcpSocketFactory(factory: TcpSocketFactory | undefined): void {
  tcpSocketFactory = factory;
}

/** The device a Wi-Fi attempt targets: the endpoint from settings (there is nothing to pick). */
export const WIFI_DEVICE_NAME = 'Wi-Fi ELM327';

/** The Classic Bluetooth module loader; undefined = `react-native-bluetooth-classic` (the app). */
let sppModuleLoader: SppModuleLoader | undefined;

/** Test seam (plan 27): open Classic Bluetooth links and list paired devices with `loader` instead
 *  of `react-native-bluetooth-classic`. `undefined` restores the default. */
export function setSppModuleLoader(loader: SppModuleLoader | undefined): void {
  sppModuleLoader = loader;
}

/** The browser's Web Bluetooth; undefined = `navigator.bluetooth` (the web app). */
let webBluetooth: WebBluetoothLike | null | undefined;

/** Test seam (plan 28): pick Web Bluetooth devices from `bt` instead of `navigator.bluetooth`
 *  (null = a browser without Web Bluetooth). `undefined` restores the default. */
export function setWebBluetooth(bt: WebBluetoothLike | null | undefined): void {
  webBluetooth = bt;
}

/** The Web Bluetooth in use: the test seam's, else `navigator.bluetooth` (null when absent). */
function activeWebBluetooth(): WebBluetoothLike | null {
  return webBluetooth === undefined ? getWebBluetooth() : webBluetooth;
}

/** True when this browser can open Bluetooth LE adapters (Chrome / Edge over HTTPS). */
export function isWebBluetoothSupported(): boolean {
  return activeWebBluetooth() !== null;
}

/** The name a Web Bluetooth attempt shows when the chooser reported none. */
export const WEB_BLE_DEVICE_NAME = 'Bluetooth LE adapter';

/** Open the browser's Bluetooth device chooser and turn the pick into a connect target. Must run
 *  from the button's press handler (Chrome needs a user gesture). Rejects with the browser's error
 *  (a cancelled chooser is a `NotFoundError`). */
export async function pickWebBluetoothAdapter(): Promise<ConnectTarget> {
  const device = await WebBluetoothTransport.pickDevice(activeWebBluetooth());
  return { deviceId: device.id, deviceName: device.name ?? undefined, webDevice: device };
}

/** The web build's **Choose adapter & connect** (plan 28): open the chooser (first, inside the
 *  user gesture), then connect to the picked adapter. A cancelled chooser or a browser without Web
 *  Bluetooth is not a failed connection: from any idle state (including an earlier attempt's
 *  `error`) the app ends `disconnected` with a plain-English message, so the diagnostics panel —
 *  which would describe that earlier attempt — closes. A live (or in-flight) session is left alone;
 *  the message is only a toast. Resolves true once connected. */
export async function chooseWebAdapterAndConnect(): Promise<boolean> {
  let target: ConnectTarget;
  try {
    target = await pickWebBluetoothAdapter();
  } catch (e) {
    const message = describeWebBluetoothError(e);
    logError({ source: 'connection/web-bluetooth', error: e, severity: 'warning' });
    const store = useSessionStore.getState();
    // Live or in flight: connected, any connect stage (`connecting`, `initializing`), or an
    // auto-reconnect run — including its back-off sleep, when the status may read `error`.
    const live =
      store.status === 'connected' ||
      store.status === 'connecting' ||
      store.status === 'initializing' ||
      reconnectRun !== null;
    if (live) {
      showToast(message);
    } else {
      store.setStatus('disconnected');
      store.setError(message);
    }
    return false;
  }
  await connect(target);
  return useSessionStore.getState().status === 'connected';
}

/** The name an SPP attempt shows when the paired device has none. */
export const SPP_DEVICE_NAME = 'Classic Bluetooth adapter';

/** The phone's paired (bonded) Bluetooth devices for the Classic Bluetooth picker, likely OBD2
 *  adapters first. Throws a plain-English error when Bluetooth is off or the module is absent. */
export function listPairedAdapters(): Promise<BondedAdapter[]> {
  return listBondedAdapters(sppModuleLoader);
}

function detachStatusWatch(): void {
  statusUnsub?.();
  statusUnsub = null;
}

function abortReconnect(): void {
  if (reconnectRun) {
    reconnectRun.aborted = true;
    reconnectRun.cancelSleep();
    reconnectRun = null;
  }
}

/** A setTimeout that the reconnect controller can cancel to abort a pending backoff wait. */
function abortableSleep(ms: number, run: { cancelSleep: () => void }): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    run.cancelSleep = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

/** Watch the live transport for an unsolicited status drop. */
function watchStatus(transport: Transport): void {
  detachStatusWatch();
  statusUnsub = transport.onStatusChange((s: TransportStatus) => {
    if (s === 'disconnected' || s === 'error') handleUnexpectedDrop();
  });
}

/** React to a link that dropped on its own (adapter pulled, out of range). Detach the dead session,
 *  surface an actionable error, and kick off auto-reconnect when enabled — unless the flap guard
 *  says the link is dropping too often. A manual disconnect never reaches here: it detaches the
 *  watcher first. */
function handleUnexpectedDrop(): void {
  const store = useSessionStore.getState();
  // Only the first drop of a live session matters; ignore echoes once we've already handled it.
  if (store.status !== 'connected' && store.status !== 'initializing') return;
  detachStatusWatch();

  // Best-effort: detach the client and close the (already-dead) transport so its monitor/listener
  // don't leak. Runs against the wrapped transport stored on the session.
  store.session?.disconnect().catch(() => undefined);

  liveRawTransport = null;
  store.markDisconnected(LINK_LOST_MESSAGE);
  logError({
    source: 'connection',
    error: new Error('Adapter link lost (unsolicited transport disconnect)'),
    severity: 'warning',
  });

  // Flap guard: a link that keeps dropping must not reconnect forever.
  const now = Date.now();
  dropsAt = pruneDrops([...dropsAt, now], now);
  if (!useSettingsStore.getState().autoReconnect) return;
  if (shouldAutoReconnect(dropsAt, now)) {
    startAutoReconnect();
  } else {
    useSessionStore.getState().setError(FLAP_PAUSED_MESSAGE);
    logError({
      source: 'connection/auto-reconnect',
      error: new Error(`Auto-reconnect paused after ${dropsAt.length} drops in a minute`),
      severity: 'warning',
    });
  }
}

function startAutoReconnect(): void {
  abortReconnect();
  const run = { aborted: false, cancelSleep: () => undefined as void };
  reconnectRun = run;
  const target = lastTarget;

  void runReconnect({
    sleep: (ms) => abortableSleep(ms, run),
    isAborted: () => run.aborted,
    onAttempt: (attempt, total) => {
      if (run.aborted) return;
      const store = useSessionStore.getState();
      store.setStatus('connecting');
      store.setError(`Reconnecting to the adapter… attempt ${attempt} of ${total}.`);
    },
    // connectInternal (not the public connect) so this attempt doesn't abort its own run.
    attemptConnect: async () => {
      if (run.aborted) return false;
      await connectInternal(target);
      return true;
    },
  }).then((ok) => {
    if (reconnectRun === run) reconnectRun = null;
    if (!ok && !run.aborted) {
      // End in `error` (not `disconnected`) so the diagnostics panel stays up for the failure the
      // user has to act on, and keep the last attempt's cause in the text for its classifier.
      const store = useSessionStore.getState();
      const cause = store.error ? ` Last error: ${store.error}` : '';
      store.setStatus('error');
      store.setError(
        `Auto-reconnect failed after ${RECONNECT_DELAYS_MS.length} attempts. Reconnect manually ` +
          `when the adapter is powered and back in range.${cause}`,
      );
    }
  });
}

// --- Connect / disconnect -----------------------------------------------------------------------

/** Internal signal: the adapter source changed while a connect was in flight (see `connectEpoch`). */
class StaleConnectError extends Error {
  constructor() {
    super('Connect superseded by an adapter-source switch');
  }
}

/** The negotiated BLE link of `t` (native or Web Bluetooth), or null for any other transport. */
function linkInfoOf(t: Transport) {
  return t instanceof BleTransport || t instanceof WebBluetoothTransport ? t.linkInfo : null;
}

/** Build the transport + session, run init, and publish the connected state. Does NOT touch the
 *  auto-reconnect controller, so it is safe to call from within a reconnect attempt. */
async function connectInternal(target?: ConnectTarget): Promise<void> {
  const { adapterSource, simulatedVehicleId, injectedDtcs, wifi } = useSettingsStore.getState();
  const epoch = connectEpoch;
  /** True once the adapter source was switched while this connect was in flight. */
  const stale = () => epoch !== connectEpoch;
  const store = useSessionStore.getState();
  const link = useLinkStore.getState();
  detachStatusWatch();
  liveRawTransport = null;
  store.setError(null);
  store.setStatus('connecting');
  // The attempt's device is known up front; record it now so a failed attempt is reported against
  // the adapter it targeted (sessionStore only learns the device on success, and keeps the old one
  // after a drop).
  const attemptDevice =
    adapterSource === 'ble' || adapterSource === 'spp'
      ? target
        ? {
            id: target.deviceId,
            name:
              target.deviceName ??
              (adapterSource === 'spp'
                ? SPP_DEVICE_NAME
                : target.webDevice
                  ? WEB_BLE_DEVICE_NAME
                  : null),
          }
        : null
      : adapterSource === 'wifi'
        ? { id: formatEndpoint(wifi), name: WIFI_DEVICE_NAME }
        : { id: 'mock', name: `Simulator · ${simulatedVehicleId}` };
  link.beginAttempt(
    adapterSource === 'ble' ? 'bluetooth' : 'transport',
    attemptDevice,
    adapterSource === 'mock' ? null : adapterSource,
  );
  // Stamp how the adapter log's traffic is recorded (plan W2) before the first write, so a replay
  // fixture exported later is labelled by the session that produced it, not by the settings then.
  beginAdapterLogRecording(
    adapterSource === 'mock'
      ? { source: 'simulator', simulatedVehicleId }
      : {
          source: 'car',
          deviceId: adapterSource === 'wifi' ? attemptDevice?.id : target?.deviceId,
        },
  );

  let transport: Transport | undefined;
  let session: DiagnosticSession | undefined;
  let linkUnsub: (() => void) | null = null;
  try {
    let rawTransport: Transport;
    let device: AttemptDevice;
    let wakeAfterIdleMs: number;

    if (adapterSource === 'ble' && target?.webDevice && attemptDevice) {
      // Web Bluetooth (plan 28): the browser asked for permission in its own chooser, so there is
      // no runtime prompt; the picked device is reopened as-is (auto-reconnect included).
      rawTransport = new WebBluetoothTransport(target.webDevice);
      device = attemptDevice;
      wakeAfterIdleMs = DEFAULT_WAKE_AFTER_IDLE_MS;
    } else if (adapterSource === 'ble') {
      if (!target || !attemptDevice) throw new Error('Select a Bluetooth device first');
      if (!(await requestBlePermissions())) throw new Error('Bluetooth permission denied');
      rawTransport = new BleTransport(getBleManager(), target.deviceId);
      device = attemptDevice;
      // Real adapters auto-sleep when idle: wake them before a command after 20 s of silence.
      wakeAfterIdleMs = DEFAULT_WAKE_AFTER_IDLE_MS;
    } else if (adapterSource === 'spp') {
      // Classic Bluetooth (plan 27, Android): an RFCOMM socket to a device paired in Android
      // settings. RFCOMM needs only BLUETOOTH_CONNECT on API 31+ and no runtime permission before
      // (never the BLE location prompt). `lastTarget` keeps the address, so auto-reconnect replays
      // it unchanged.
      if (!target || !attemptDevice) throw new Error('Select a paired adapter first');
      if (!(await requestClassicBluetoothPermissions())) {
        throw new Error('Bluetooth permission denied');
      }
      rawTransport = new SppTransport(target.deviceId, sppModuleLoader);
      device = attemptDevice;
      wakeAfterIdleMs = DEFAULT_WAKE_AFTER_IDLE_MS;
    } else if (adapterSource === 'wifi') {
      // Wi-Fi ELM327 (plan 26): a TCP socket to the endpoint in settings. No permission prompt
      // (iOS asks for Local Network access by itself on the first connect). Auto-reconnect replays
      // the endpoint from settings, so `lastTarget` stays undefined.
      rawTransport = new TcpTransport(wifi, tcpSocketFactory);
      device = attemptDevice ?? { id: formatEndpoint(wifi), name: WIFI_DEVICE_NAME };
      wakeAfterIdleMs = DEFAULT_WAKE_AFTER_IDLE_MS;
    } else {
      // The in-app injector is the single source of truth for simulated faults: it sets the stored
      // codes and pins pending/permanent empty, so a profile's seeded knownFaults can't leak past the
      // user's choice (e.g. "None" really means none, even for a profile with pending/permanent faults).
      // A garage car as the simulated vehicle (plan 06) simulates its base profile with the learned
      // VIN / supported-PID set on top, so a car learned in the simulator reconnects as itself.
      const sim = simulatorSourceFor(simulatedVehicleId, useGarageStore.getState().vehicles);
      const scenario = buildScenario(sim.profileId, {
        ...sim.overrides,
        storedDtcs: injectedDtcs,
        pendingDtcs: [],
        permanentDtcs: [],
      });
      const mock = new MockTransport(scenario);
      if (failNextSimConnect) {
        // Settings → Developer → "Fail next connect": the simulated adapter ignores ATZ.
        failNextSimConnect = false;
        mock.dropResponses(1, { includeAt: true });
      }
      rawTransport = mock;
      device = attemptDevice ?? { id: 'mock', name: `Simulator · ${simulatedVehicleId}` };
      // The simulator never sleeps unless its scenario models it; then wake well inside the gap.
      const sleepMs = scenario.sleepAfterIdleMs ?? 0;
      wakeAfterIdleMs = sleepMs > 0 ? Math.max(1, Math.floor(sleepMs / 2)) : 0;
    }
    lastTarget = target;
    link.setStage('transport');
    // Record the negotiated link the moment the transport is up, so a failure later in init still
    // shows the MTU / characteristics in the diagnostics panel.
    const raw = rawTransport;
    linkUnsub = raw.onStatusChange((s) => {
      if (s !== 'connected') return;
      useLinkStore.getState().setStage('init');
      useLinkStore.getState().setLink(linkInfoOf(raw));
    });

    // Read monitor state lazily off the not-yet-created session; by the time any rx chunk arrives
    // the session below is assigned. While sniffing (ATMA) this pauses rx mirroring — see withLog.
    transport = withLog(rawTransport, () => session?.client.monitoring ?? false, stale);
    session = new DiagnosticSession(transport, {
      commandTimeoutMs: 5000,
      firstCommandTimeoutMs: 12000,
      wakeAfterIdleMs,
    });
    if (stale()) throw new StaleConnectError();
    store.setStatus('initializing');
    // Advance the diagnostics panel's "furthest stage reached" through init → probe → identify.
    const info = await session.connect((stage) => {
      if (!stale()) useLinkStore.getState().setStage(stage);
    });
    // The source was switched mid-connect (e.g. the banner's "Use real adapter" while the simulator
    // was still initializing): drop this session instead of publishing it under the new source.
    if (stale()) throw new StaleConnectError();
    // Engine part number (22 F187) once per session, cached in SessionInfo: it resolves the label
    // pack whose measuring groups the Extended PIDs screen shows (plan 14). Only on CAN and only
    // when the active profile declares extended DIDs — other cars send no Mode 22 at all. If the
    // profile only gains DIDs after connect (VIN auto-select or a manual switch to the Golf),
    // EngineHost reads it then (`sessionStore.setPartNumber`). The session memoises the outcome,
    // a null "no answer" included, so that retry never sends a second `22 F187`.
    if (isCan(info.protocol) && getActiveProfile().extendedPids?.length) {
      try {
        const partNumber = await session.readPartNumber();
        if (partNumber) info.partNumber = partNumber;
      } catch (e) {
        logError({ source: 'connection/part-number', error: e, severity: 'warning' });
      }
      if (stale()) throw new StaleConnectError();
    }
    linkUnsub();
    linkUnsub = null;
    useLinkStore.getState().setLink(linkInfoOf(rawTransport));
    liveRawTransport = rawTransport;
    useSessionStore.getState().setConnected(session, info, device);
    noteAdapterLogLink({
      adapter: info.version,
      protocol: info.protocol,
      vin: info.vin ?? undefined,
    });
    // Now that the link is up, watch for it dropping out from under us.
    watchStatus(transport);
  } catch (e) {
    linkUnsub?.();
    // Teardown the half-open transport/session before rethrowing so a probe failure (ignition off)
    // leaves no GATT link, no notify monitor, and no attached client — a later retry starts clean.
    try {
      await session?.disconnect();
    } catch {
      // best-effort
    }
    if (!session) {
      try {
        await transport?.disconnect();
      } catch {
        // best-effort
      }
    }
    // A stale connect was superseded by an adapter switch, which already reset the session store:
    // tear down quietly, without publishing an error over the new source's state.
    if (stale()) return;
    // Web Bluetooth rejects with DOMException names (NetworkError, NotFoundError…): explain them.
    const message = target?.webDevice
      ? describeWebBluetoothError(e)
      : e instanceof Error
        ? e.message
        : String(e);
    useSessionStore.getState().setStatus('error');
    useSessionStore.getState().setError(message);
    logError({ source: 'connection', error: e, context: { adapterSource } });
    throw e;
  }
}

/** Public connect: a manual connect always cancels any pending auto-reconnect first, and resets
 *  the flap guard (the user is deliberately trying again). */
export async function connect(target?: ConnectTarget): Promise<void> {
  abortReconnect();
  dropsAt = [];
  return connectInternal(target);
}

/** Manual disconnect. Cancels auto-reconnect and detaches the status watcher first, so the
 *  transport's own 'disconnected' emission is not mistaken for an unsolicited link loss. */
export async function disconnect(): Promise<void> {
  abortReconnect();
  detachStatusWatch();
  liveRawTransport = null;
  const { session } = useSessionStore.getState();
  await session?.disconnect();
  useSessionStore.getState().reset();
}

/** Change the adapter source (Settings' segments, the simulator banner, the Connect screen). A
 *  session built for the old source must not survive the switch — otherwise simulated readings would
 *  show unflagged under 'ble' (or real ones under the simulator banner). So, synchronously:
 *  invalidate any in-flight connect (it tears itself down instead of publishing), cancel a pending
 *  auto-reconnect, reset the session store, clear the adapter log and flip the setting; then close
 *  the old session. The log is cleared because a replay fixture exported from it is labelled with
 *  the source at export time — a simulator log must never be exported as `source: 'car'` (or the
 *  reverse). A no-op when the source is unchanged. */
export async function switchAdapterSource(source: AdapterSource): Promise<void> {
  if (useSettingsStore.getState().adapterSource === source) return;
  const session = invalidateConnection();
  useSettingsStore.getState().setAdapterSource(source);
  await closeOldSession(session, 'connection/switch-adapter');
}

/** The synchronous half of a source change: invalidate any in-flight connect (`connectEpoch`),
 *  cancel a pending auto-reconnect, detach the status watcher, reset the session store and clear
 *  the adapter log. Returns the session that was live, for the caller to close. */
function invalidateConnection(): DiagnosticSession | null {
  connectEpoch++;
  abortReconnect();
  detachStatusWatch();
  liveRawTransport = null;
  const { session } = useSessionStore.getState();
  useSessionStore.getState().reset();
  clearAdapterLog();
  return session;
}

async function closeOldSession(session: DiagnosticSession | null, source: string): Promise<void> {
  if (!session) return;
  try {
    await session.disconnect();
  } catch (e) {
    logError({ source, error: e, severity: 'warning' });
  }
}

/** Before a data restore (plan 18): a restored `bolid.settings` can change the adapter source and
 *  the simulated car behind this service's back, so the connection is torn down exactly as
 *  `switchAdapterSource` does it — an in-flight connect is invalidated (it tears itself down
 *  instead of publishing a session built for the old source), auto-reconnect is cancelled, the
 *  session store is reset and the adapter log is cleared (a log from the old source must never be
 *  exported as a replay fixture labelled with the restored one); then the old session is closed. */
export async function resetForRestore(): Promise<void> {
  await closeOldSession(invalidateConnection(), 'connection/restore');
}

/** Leave simulator mode for the real Bluetooth adapter (the simulator banner's / Connect screen's
 *  "Use real adapter"). See `switchAdapterSource`. */
export function switchToRealAdapter(): Promise<void> {
  return switchAdapterSource('ble');
}

/** Simulator dev hooks (Settings → Developer, shown in simulator mode). They only ever touch a
 *  `MockTransport`; with the real adapter they do nothing. */
export const __sim = {
  /** Drop the live simulator link as if the adapter were pulled — exercises link-loss handling,
   *  auto-reconnect and the flap guard. Returns false when no simulator session is live. */
  simulateDrop(): boolean {
    if (!(liveRawTransport instanceof MockTransport)) return false;
    liveRawTransport.simulateDisconnect();
    return true;
  },
  /** Arm a one-shot failure: the next simulator connect gets no reply to `ATZ` (an unpowered or
   *  asleep adapter), which opens the diagnostics panel at stage `init`. */
  failNextConnect(): void {
    failNextSimConnect = true;
  },
  /** True while a "fail next connect" is armed and not yet consumed. */
  isFailNextConnectArmed(): boolean {
    return failNextSimConnect;
  },
};
