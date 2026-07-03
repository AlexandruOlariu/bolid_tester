/** CAN bus monitor (ELM327 `ATMA` with headers on): line parsing + per-id aggregation for the
 *  sniffer screen. Pure — the Elm327Client streams lines in, the aggregator keeps id stats. */

export interface MonitorFrame {
  id: string | null; // 11-bit ('7E8') or 29-bit ('18DAF110') id; null when headers are off/unclear
  bytes: number[];
  raw: string;
}

/** Parse one monitor line, e.g. '7E8 04 41 0C 0C D0'. Tolerates glued hex and junk lines. */
export function parseMonitorLine(raw: string): MonitorFrame | null {
  const line = raw.trim().toUpperCase();
  if (!line || /SEARCHING|STOPPED|BUFFER|ERROR|UNABLE|NO DATA|ELM327/.test(line)) return null;
  const tokens = line.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.some((t) => /[^0-9A-F]/.test(t))) return null;
  let id: string | null = null;
  let dataTokens = tokens;
  if (tokens[0].length === 3 || tokens[0].length === 8) {
    id = tokens[0];
    dataTokens = tokens.slice(1);
  }
  const hex = dataTokens.join('');
  if (hex.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return { id, bytes, raw: line };
}

export interface FrameStat {
  id: string;
  count: number;
  /** Frames per second over the observed window. */
  rate: number;
  lastBytes: number[];
  lastTs: number;
}

/** Per-id stream statistics for the sniffer table. */
export class CanFrameAggregator {
  private stats = new Map<string, { count: number; firstTs: number; lastTs: number; lastBytes: number[] }>();

  add(raw: string, ts = Date.now()): MonitorFrame | null {
    const frame = parseMonitorLine(raw);
    if (!frame) return null;
    const key = frame.id ?? '(no id)';
    const s = this.stats.get(key);
    if (s) {
      s.count += 1;
      s.lastTs = ts;
      s.lastBytes = frame.bytes;
    } else {
      this.stats.set(key, { count: 1, firstTs: ts, lastTs: ts, lastBytes: frame.bytes });
    }
    return frame;
  }

  snapshot(): FrameStat[] {
    return [...this.stats.entries()]
      .map(([id, s]) => ({
        id,
        count: s.count,
        rate:
          s.lastTs > s.firstTs ? Math.round((s.count / ((s.lastTs - s.firstTs) / 1000)) * 10) / 10 : 0,
        lastBytes: s.lastBytes,
        lastTs: s.lastTs,
      }))
      .sort((a, b) => b.count - a.count);
  }

  clear(): void {
    this.stats.clear();
  }
}
