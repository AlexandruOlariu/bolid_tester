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

/** Fixed capacity — bounded memory regardless of session length; oldest entries fall off. */
export const ADAPTER_LOG_CAPACITY = 300;

/** Max publish rate to the zustand store: one snapshot per 250 ms (~4 Hz). */
export const ADAPTER_LOG_PUBLISH_INTERVAL_MS = 250;

// --- Ring buffer (module-level, single app-wide adapter connection) ------------------------------

const buffer: LogEntry[] = new Array(ADAPTER_LOG_CAPACITY);
let start = 0; // index of the oldest entry once the buffer is full
let count = 0; // number of live entries (≤ capacity)

/** Snapshot the buffer into a fresh array in chronological (oldest-first) order. */
export function adapterLogSnapshot(): LogEntry[] {
  const out: LogEntry[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = buffer[(start + i) % ADAPTER_LOG_CAPACITY];
  return out;
}

// --- Throttled publish to the zustand store ------------------------------------------------------

interface AdapterLogState {
  entries: LogEntry[];
}

/** Subscribe here (UI) — updated at most ~4 Hz. Never write from the hot path. */
export const useAdapterLogStore = create<AdapterLogState>(() => ({ entries: [] }));

let publishTimer: ReturnType<typeof setTimeout> | null = null;
let lastPublishAt = 0;

function publishNow(): void {
  lastPublishAt = Date.now();
  useAdapterLogStore.setState({ entries: adapterLogSnapshot() });
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
  if (count < ADAPTER_LOG_CAPACITY) {
    buffer[(start + count) % ADAPTER_LOG_CAPACITY] = entry;
    count++;
  } else {
    buffer[start] = entry;
    start = (start + 1) % ADAPTER_LOG_CAPACITY;
  }
  schedulePublish();
}

/** Drop every buffered entry and publish the empty log immediately (cancels any pending flush). */
export function clearAdapterLog(): void {
  start = 0;
  count = 0;
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  publishNow();
}
