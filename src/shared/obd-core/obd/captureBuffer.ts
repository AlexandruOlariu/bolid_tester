/** Bounded capture of a sniffer (`ATMA`) run: every adapter line, timestamped and parsed, kept in a
 *  ring so a long session can be saved and shared (see docs/features/can-sniffer.md). Pure. */
import { parseMonitorLine, type MonitorFrame } from './canMonitor';

export interface CapturedLine {
  /** Wall-clock time the line arrived (ms since epoch). */
  t: number;
  /** The adapter line exactly as received. */
  raw: string;
  /** The parsed frame, or null for notices / junk (`BUFFER FULL`, `SEARCHING...`, partial lines). */
  frame: MonitorFrame | null;
}

export const DEFAULT_CAPTURE_CAPACITY = 20_000;

/** Fixed-capacity, chronological line buffer. Past capacity the OLDEST line is evicted and counted
 *  in `dropped`, so memory stays bounded however long the bus is monitored. O(1) per push. */
export class CaptureBuffer {
  readonly capacity: number;
  private ring: CapturedLine[] = [];
  /** Index of the oldest line once the ring is full. */
  private head = 0;
  private evicted = 0;

  constructor(capacity = DEFAULT_CAPTURE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`CaptureBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  /** Record one adapter line (parsed with `parseMonitorLine`); evicts the oldest past capacity. */
  push(raw: string, t: number): void {
    const line: CapturedLine = { t, raw, frame: parseMonitorLine(raw) };
    if (this.ring.length < this.capacity) {
      this.ring.push(line);
      return;
    }
    this.ring[this.head] = line;
    this.head = (this.head + 1) % this.capacity;
    this.evicted += 1;
  }

  get size(): number {
    return this.ring.length;
  }

  /** Lines evicted because the capture outgrew `capacity`. */
  get dropped(): number {
    return this.evicted;
  }

  /** Chronological copy (oldest first). */
  lines(): CapturedLine[] {
    if (this.head === 0) return this.ring.slice();
    return [...this.ring.slice(this.head), ...this.ring.slice(0, this.head)];
  }

  clear(): void {
    this.ring = [];
    this.head = 0;
    this.evicted = 0;
  }
}
