/** Adapter I/O log — a module-level ring buffer for the raw tx/rx traffic between the app and the
 *  ELM327, decoupled from React state on the hot path.
 *
 *  Why not a plain zustand array (as before)? `withLog` in connectionService mirrors every tx
 *  command and every rx BLE chunk here. During a CAN sniff (`ATMA` on a busy bus) that is hundreds
 *  of events per second; the old design copied a ≤300-entry array into a zustand `set` per event,
 *  re-rendering any subscribed screen hundreds of times a second on the JS thread (finding F5).
 *
 *  Here the hot path is a plain O(1) ring-buffer write with no allocation and no React notification.
 *  A separate, throttled publish (≤ ~4 Hz, with a trailing flush so the last burst always lands)
 *  snapshots the buffer into a tiny zustand store, so subscribed UI still updates smoothly without
 *  per-event churn. See docs/features/settings.md. */
import { create } from 'zustand';

/** One line of adapter traffic. Structurally compatible with obd-core's `LoggedIo` (the replay
 *  fixture exporter consumes a `LogEntry[]` directly). */
export interface LogEntry {
  dir: 'tx' | 'rx';
  text: string;
  ts: number;
}

/** How the traffic in the log was recorded (plan W2). `connectionService` stamps it when a connect
 *  starts (the source and, for the simulator, the simulated car) and adds the adapter version and
 *  protocol once the connect succeeds. The replay export (Settings) labels the fixture from this,
 *  not from the settings at export time, so a log keeps its provenance after a disconnect, a
 *  changed simulated car or an adapter-source change made behind the service's back. */
export interface AdapterLogOrigin {
  source: 'simulator' | 'car';
  /** The simulated vehicle (registry or garage id) the simulator ran; only for `simulator`. */
  simulatedVehicleId?: string;
  /** The BLE adapter (device id) the session ran on; only for `car`. */
  deviceId?: string;
  /** The adapter's `ATI` version and the negotiated protocol of the recorded session. */
  adapter?: string;
  protocol?: string;
  /** The VIN the recorded session read (Mode 09 PID 02), when the car answered it. */
  vin?: string;
}

/** Fixed capacity — bounded memory regardless of session length; oldest entries fall off. */
export const ADAPTER_LOG_CAPACITY = 300;

/** Max publish rate to the zustand store: one snapshot per 250 ms (~4 Hz). */
export const ADAPTER_LOG_PUBLISH_INTERVAL_MS = 250;

// --- Ring buffer (module-level, single app-wide adapter connection) ------------------------------

const buffer: LogEntry[] = new Array(ADAPTER_LOG_CAPACITY);
let start = 0; // index of the oldest entry once the buffer is full
let count = 0; // number of live entries (≤ capacity)
let dropped = 0; // entries overwritten since the last clear (the log has wrapped when > 0)
let origin: AdapterLogOrigin | null = null; // provenance of the entries (null = unknown)
let appended = 0; // entries appended since the last clear (sequence number of the next entry)
let connectStartSeq = 0; // sequence number of the first entry of the latest connect

/** Snapshot the buffer into a fresh array in chronological (oldest-first) order. */
export function adapterLogSnapshot(): LogEntry[] {
  const out: LogEntry[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = buffer[(start + i) % ADAPTER_LOG_CAPACITY];
  return out;
}

// --- Throttled publish to the zustand store ------------------------------------------------------

interface AdapterLogState {
  entries: LogEntry[];
  /** Oldest entries lost to the ring buffer since the last clear. When > 0, `entries` starts
   *  mid-session, so a replay fixture exported from it is incomplete (Settings warns). */
  dropped: number;
  /** How the entries were recorded, or null when unknown (nothing connected since the log was
   *  reset by a source switch / restore). Settings' Clear keeps it (`clearAdapterLogEntries`). */
  origin: AdapterLogOrigin | null;
}

/** Subscribe here (UI) — updated at most ~4 Hz. Never write from the hot path. */
export const useAdapterLogStore = create<AdapterLogState>(() => ({
  entries: [],
  dropped: 0,
  origin: null,
}));

let publishTimer: ReturnType<typeof setTimeout> | null = null;
let lastPublishAt = 0;

function publishNow(): void {
  lastPublishAt = Date.now();
  useAdapterLogStore.setState({ entries: adapterLogSnapshot(), dropped, origin });
}

/** Publish a snapshot, rate-limited to `ADAPTER_LOG_PUBLISH_INTERVAL_MS`. A publish that arrives too
 *  soon after the previous one is coalesced into a single trailing flush, so the final burst of a
 *  fast stream is never dropped. */
function schedulePublish(): void {
  if (publishTimer) return; // a trailing flush is already queued; it will pick up new entries
  const elapsed = Date.now() - lastPublishAt;
  if (elapsed >= ADAPTER_LOG_PUBLISH_INTERVAL_MS) {
    publishNow();
  } else {
    publishTimer = setTimeout(() => {
      publishTimer = null;
      publishNow();
    }, ADAPTER_LOG_PUBLISH_INTERVAL_MS - elapsed);
  }
}

/** Append one line of adapter traffic. O(1), allocation-free, no React notification — the throttled
 *  publisher does the (rate-limited) store update. */
export function appendAdapterLog(entry: LogEntry): void {
  appended++;
  if (count < ADAPTER_LOG_CAPACITY) {
    buffer[(start + count) % ADAPTER_LOG_CAPACITY] = entry;
    count++;
  } else {
    buffer[start] = entry;
    start = (start + 1) % ADAPTER_LOG_CAPACITY;
    dropped++;
  }
  schedulePublish();
}

/** The current log's provenance (see `AdapterLogOrigin`), or null when unknown. */
export function adapterLogOrigin(): AdapterLogOrigin | null {
  return origin;
}

/** Same source, same simulated car and (on the car) the same BLE adapter. Whether a real-adapter
 *  reconnect reached the same car is only known once it succeeds (`noteAdapterLogLink`). */
const sameRecording = (a: AdapterLogOrigin, b: AdapterLogOrigin): boolean =>
  a.source === b.source &&
  a.simulatedVehicleId === b.simulatedVehicleId &&
  a.deviceId === b.deviceId;

/** The link details of two sessions on the same adapter name different cars: another VIN, or —
 *  when either VIN is unknown — another negotiated protocol (one car always negotiates the same). */
const otherCar = (prev: AdapterLogOrigin, link: { protocol?: string; vin?: string }): boolean =>
  prev.vin && link.vin
    ? prev.vin !== link.vin
    : !!prev.protocol && !!link.protocol && prev.protocol !== link.protocol;

/** A connect is starting (connectionService, before its first write). A log holds one recording
 *  only: when it already holds traffic from another source, another simulated car or another BLE
 *  adapter — or traffic no connect stamped (origin unknown), which may be anything — it is cleared
 *  first, so a fixture exported from it can never mix two. A reconnect to the same one keeps the
 *  log (and its link details until the new connect reports its own, see `noteAdapterLogLink`). */
export function beginAdapterLogRecording(next: AdapterLogOrigin): void {
  const same = origin !== null && sameRecording(origin, next);
  if (count > 0 && !same) clearAdapterLog();
  origin = same && origin ? { ...origin, ...next } : { ...next };
  connectStartSeq = appended;
  publishNow();
}

/** Drop the buffered entries logged before the latest connect began, keeping that connect's own. */
function dropBeforeLatestConnect(): void {
  const oldestSeq = appended - count;
  const n = Math.max(0, Math.min(count, connectStartSeq - oldestSeq));
  start = (start + n) % ADAPTER_LOG_CAPACITY;
  count -= n;
  // Only the latest connect's entries are left: count those it lost to the wrap, if any.
  dropped = Math.max(0, oldestSeq - connectStartSeq);
}

/** The connect succeeded: record the adapter version, protocol and VIN of the session being logged.
 *  When the reconnect reached another car on the same adapter (`otherCar`), the earlier car's
 *  traffic is dropped first, so the log — and a fixture exported from it — holds this session only
 *  and the new link details never relabel the previous car's traffic. */
export function noteAdapterLogLink(link: {
  adapter?: string;
  protocol?: string;
  vin?: string;
}): void {
  if (!origin) return;
  if (otherCar(origin, link)) {
    dropBeforeLatestConnect();
    const { simulatedVehicleId: prevSim, deviceId: prevDevice } = origin;
    origin = { source: origin.source };
    if (prevSim !== undefined) origin.simulatedVehicleId = prevSim;
    if (prevDevice !== undefined) origin.deviceId = prevDevice;
  }
  origin = { ...origin, ...link };
  publishNow();
}

function dropEntries(): void {
  start = 0;
  count = 0;
  dropped = 0;
  appended = 0;
  connectStartSeq = 0;
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
}

/** Settings' **Clear**, between two recorded flows: drop every buffered entry but keep the
 *  provenance. Only a connect writes to the log, and it stamps the origin first, so whatever is
 *  logged after this Clear still comes from the recording the origin describes — the live session
 *  (whose link details stay known), or, when disconnected, the next connect, which re-stamps it.
 *  Publishes the empty log immediately (cancels any pending flush). */
export function clearAdapterLogEntries(): void {
  dropEntries();
  publishNow();
}

/** Drop every buffered entry and its provenance (a source switch / restore ends the recording),
 *  and publish the empty log immediately (cancels any pending flush). */
export function clearAdapterLog(): void {
  dropEntries();
  origin = null;
  publishNow();
}
