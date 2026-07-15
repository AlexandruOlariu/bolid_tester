/** The connection feature's service layer: builds the right Transport (mock or BLE), wires the
 *  adapter I/O log, runs the DiagnosticSession, and updates the shared stores.
 *  Note: "api" here means device/engine access, not a network API.
 *
 *  It also owns the *link-loss lifecycle*: once connected it watches the transport's status events
 *  and, on an unsolicited drop, flips the app to disconnected (instead of letting every later
 *  command time out) and — if the user enabled it — drives auto-reconnect with backoff. */

import { Transport, TransportStatus } from '@/shared/obd-core/transport/Transport';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { bytesToString } from '@/shared/lib/bytes';
import { BleTransport } from '@/shared/transports/ble/BleTransport';
import { getBleManager } from '@/shared/transports/ble/manager';
import { requestBlePermissions } from '@/shared/transports/ble/permissions';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { appendAdapterLog } from '@/shared/state/adapterLog';
import { logError } from '@/shared/state/errorLogStore';
import { runReconnect, RECONNECT_DELAYS_MS } from './reconnect';

/** Tap the transport to mirror every command/response into the adapter I/O log (a throttled ring
 *  buffer — see adapterLog.ts).
 *
 *  `isMonitoring` reports whether the ELM client is currently in monitor mode (`ATMA` sniff). While
 *  monitoring we do NOT mirror rx chunks: the sniffer feature has its own line listener on that same
 *  firehose, so logging here would double-handle hundreds of frames per second for no benefit
 *  (finding F5). tx commands are always logged — there are only a couple during a sniff (the ATMA
 *  and the stop). */
function withLog(inner: Transport, isMonitoring: () => boolean): Transport {
  return {
    get status() {
      return inner.status;
    },
    connect: () => inner.connect(),
    disconnect: () => inner.disconnect(),
    write: (bytes) => {
      appendAdapterLog({ dir: 'tx', text: bytesToString(bytes).replace(/[\r\n]/g, '').trim(), ts: Date.now() });
      return inner.write(bytes);
    },
    onData: (listener) =>
      inner.onData((bytes) => {
        if (!isMonitoring())
          appendAdapterLog({ dir: 'rx', text: bytesToString(bytes).replace(/[\r\n>]/g, ' ').trim(), ts: Date.now() });
        listener(bytes);
      }),
    onStatusChange: (listener) => inner.onStatusChange(listener),
  };
}

export interface ConnectTarget {
  deviceId: string;
  deviceName?: string;
}

const LINK_LOST_MESSAGE =
  'Adapter link lost — the connection dropped unexpectedly. Check the adapter is seated in the ' +
  'OBD2 port and reconnect.';

// --- Link-loss + auto-reconnect state (module-level, single active connection) -------------------

/** Unsubscribe for the status watcher on the live transport, or null when nothing is watched. */
let statusUnsub: (() => void) | null = null;
/** The last connect target, replayed by auto-reconnect (undefined for the simulator). */
let lastTarget: ConnectTarget | undefined;
/** The in-flight auto-reconnect run, if any. `cancelSleep` wakes a pending backoff wait early. */
let reconnectRun: { aborted: boolean; cancelSleep: () => void } | null = null;

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
 *  surface an actionable error, and kick off auto-reconnect when enabled. A manual disconnect never
 *  reaches here: it detaches the watcher first. */
function handleUnexpectedDrop(): void {
  const store = useSessionStore.getState();
  // Only the first drop of a live session matters; ignore echoes once we've already handled it.
  if (store.status !== 'connected' && store.status !== 'initializing') return;
  detachStatusWatch();

  // Best-effort: detach the client and close the (already-dead) transport so its monitor/listener
  // don't leak. Runs against the wrapped transport stored on the session.
  store.session?.disconnect().catch(() => undefined);

  store.markDisconnected(LINK_LOST_MESSAGE);
  logError({
    source: 'connection',
    error: new Error('Adapter link lost (unsolicited transport disconnect)'),
    severity: 'warning',
  });

  if (useSettingsStore.getState().autoReconnect) startAutoReconnect();
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
      const store = useSessionStore.getState();
      store.setStatus('disconnected');
      store.setError(
        `Auto-reconnect failed after ${RECONNECT_DELAYS_MS.length} attempts. Reconnect manually ` +
          'when the adapter is powered and back in range.',
      );
    }
  });
}

// --- Connect / disconnect -----------------------------------------------------------------------

/** Build the transport + session, run init, and publish the connected state. Does NOT touch the
 *  auto-reconnect controller, so it is safe to call from within a reconnect attempt. */
async function connectInternal(target?: ConnectTarget): Promise<void> {
  const { adapterSource, simulatedVehicleId, injectedDtcs } = useSettingsStore.getState();
  const store = useSessionStore.getState();
  detachStatusWatch();
  store.setError(null);
  store.setStatus('connecting');

  let transport: Transport | undefined;
  let session: DiagnosticSession | undefined;
  try {
    let rawTransport: Transport;
    let device: { id: string | null; name: string | null };

    if (adapterSource === 'ble') {
      if (!target) throw new Error('Select a Bluetooth device first');
      if (!(await requestBlePermissions())) throw new Error('Bluetooth permission denied');
      rawTransport = new BleTransport(getBleManager(), target.deviceId);
      device = { id: target.deviceId, name: target.deviceName ?? null };
    } else {
      // The in-app injector is the single source of truth for simulated faults: it sets the stored
      // codes and pins pending/permanent empty, so a profile's seeded knownFaults can't leak past the
      // user's choice (e.g. "None" really means none, even for a profile with pending/permanent faults).
      rawTransport = new MockTransport(
        buildScenario(simulatedVehicleId, { storedDtcs: injectedDtcs, pendingDtcs: [], permanentDtcs: [] }),
      );
      device = { id: 'mock', name: `Simulator · ${simulatedVehicleId}` };
    }
    lastTarget = target;

    // Read monitor state lazily off the not-yet-created session; by the time any rx chunk arrives
    // the session below is assigned. While sniffing (ATMA) this pauses rx mirroring — see withLog.
    transport = withLog(rawTransport, () => session?.client.monitoring ?? false);
    session = new DiagnosticSession(transport, {
      commandTimeoutMs: 5000,
      firstCommandTimeoutMs: 12000,
    });
    store.setStatus('initializing');
    const info = await session.connect();
    useSessionStore.getState().setConnected(session, info, device);
    // Now that the link is up, watch for it dropping out from under us.
    watchStatus(transport);
  } catch (e) {
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
    const message = e instanceof Error ? e.message : String(e);
    useSessionStore.getState().setStatus('error');
    useSessionStore.getState().setError(message);
    logError({ source: 'connection', error: e, context: { adapterSource } });
    throw e;
  }
}

/** Public connect: a manual connect always cancels any pending auto-reconnect first. */
export async function connect(target?: ConnectTarget): Promise<void> {
  abortReconnect();
  return connectInternal(target);
}

/** Manual disconnect. Cancels auto-reconnect and detaches the status watcher first, so the
 *  transport's own 'disconnected' emission is not mistaken for an unsolicited link loss. */
export async function disconnect(): Promise<void> {
  abortReconnect();
  detachStatusWatch();
  const { session } = useSessionStore.getState();
  await session?.disconnect();
  useSessionStore.getState().reset();
}
