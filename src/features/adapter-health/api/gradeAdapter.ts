/** Pure grading logic for the adapter health check — no device I/O, unit-tested.
 *
 *  Given the identity strings (`ATI`/`ATRV`/`ATDPN`) and a set of measured `0100` round-trip
 *  latencies, produce a plain **good / ok / poor** grade plus human-readable notes. The heuristics
 *  are deliberately conservative: a clone that answers quickly is still usable (graded "ok"), while
 *  a slow or non-answering adapter is "poor". See docs/features/adapter-health.md. */

export type AdapterGrade = 'good' | 'ok' | 'poor';

export interface AdapterHealthInput {
  /** `ATI` firmware identifier, e.g. "ELM327 v1.5". */
  version: string;
  /** `ATRV` supply voltage, or null when unreadable. */
  voltage: number | null;
  /** Human protocol label (`PROTOCOL_LABELS[...]`), used only to pick CAN vs K-line thresholds. */
  protocol: string;
  /** Per-command round-trip latency (ms) of the `0100` burst; failed commands are omitted. */
  latenciesMs: number[];
}

export interface AdapterLatencyStats {
  min: number;
  median: number;
  max: number;
  count: number;
}

export interface AdapterHealthResult {
  grade: AdapterGrade;
  latency: AdapterLatencyStats | null;
  notes: string[];
  cloneSuspected: boolean;
}

/** Firmware version strings that genuine ELM327 silicon never reports — the canonical clone tells.
 *  Real chips topped out at v1.x years ago; clones flash inflated "v1.5"/"v2.1" strings. */
const CLONE_VERSION_HINTS = ['v1.5', 'v2.1'];

/** Latency thresholds (ms) for the median `0100` round trip. CAN is fast; K-line/J1850 is slower by
 *  design, so it gets a more forgiving budget rather than being unfairly graded "poor". */
const THRESHOLDS = {
  can: { good: 50, ok: 150 },
  slow: { good: 150, ok: 400 },
};

/** Summarize the burst latencies (min / median / max), or null when nothing completed. */
export function summarizeLatency(latenciesMs: number[]): AdapterLatencyStats | null {
  const xs = latenciesMs.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { min: xs[0], median, max: xs[xs.length - 1], count: xs.length };
}

/** Grade an adapter from its identity + latency burst. Pure. */
export function gradeAdapter(input: AdapterHealthInput): AdapterHealthResult {
  const notes: string[] = [];
  const version = (input.version ?? '').trim();
  const versionLc = version.toLowerCase();

  const cloneSuspected = version.length > 0 && CLONE_VERSION_HINTS.some((h) => versionLc.includes(h));
  if (cloneSuspected) {
    notes.push(
      `Firmware "${version}" matches a common clone version string — genuine ELM327 chips are rare; expect occasional protocol quirks.`,
    );
  } else if (version.length === 0) {
    notes.push('Adapter did not return a firmware identifier (ATI) — responses may be unreliable.');
  }

  if (input.voltage == null) {
    notes.push('No voltage reading (ATRV) — the adapter may not be reading the vehicle supply.');
  } else if (input.voltage < 11.5) {
    notes.push(
      `Supply voltage ${input.voltage.toFixed(1)} V is low — weak battery or ignition off; live readings may drop out.`,
    );
  }

  const isCan = /CAN/i.test(input.protocol ?? '');
  const link = isCan ? 'CAN' : 'K-line';
  const budget = isCan ? THRESHOLDS.can : THRESHOLDS.slow;

  const latency = summarizeLatency(input.latenciesMs);
  let latencyGrade: AdapterGrade;
  if (!latency) {
    latencyGrade = 'poor';
    notes.push('No 0100 responses completed — the adapter or the bus is not answering.');
  } else {
    const m = Math.round(latency.median);
    if (latency.median <= budget.good) {
      latencyGrade = 'good';
      notes.push(`Median command latency ${m} ms (${link}) — snappy.`);
    } else if (latency.median <= budget.ok) {
      latencyGrade = 'ok';
      notes.push(`Median command latency ${m} ms (${link}) — acceptable but not fast.`);
    } else {
      latencyGrade = 'poor';
      notes.push(`Median command latency ${m} ms (${link}) — slow; a genuine adapter is usually quicker.`);
    }
  }

  // Latency drives the baseline; a clone tell caps an otherwise-"good" adapter at "ok" (it works, but
  // don't promise flawless). A clone that is already slow stays "poor".
  let grade = latencyGrade;
  if (cloneSuspected && grade === 'good') grade = 'ok';

  return { grade, latency, notes, cloneSuspected };
}
