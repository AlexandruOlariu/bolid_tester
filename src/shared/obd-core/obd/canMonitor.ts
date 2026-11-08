/** CAN bus monitor (ELM327 `ATMA` with headers on): line parsing + per-id aggregation for the
 *  sniffer screen, and the capture file formats (CSV / raw dump). Pure — the Elm327Client streams
 *  lines in, the aggregator keeps id stats, a `CaptureBuffer` keeps the lines for export. */
import type { CapturedLine } from './captureBuffer';

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
  private stats = new Map<
    string,
    { count: number; firstTs: number; lastTs: number; lastBytes: number[] }
  >();

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
          s.lastTs > s.firstTs
            ? Math.round((s.count / ((s.lastTs - s.firstTs) / 1000)) * 10) / 10
            : 0,
        lastBytes: s.lastBytes,
        lastTs: s.lastTs,
      }))
      .sort((a, b) => b.count - a.count);
  }

  clear(): void {
    this.stats.clear();
  }
}

/** Context written at the top of a saved capture. */
export interface CaptureHeader {
  vehicleId: string;
  protocol?: string;
  adapter?: string;
  /** Capture start (ms since epoch); every `t_ms` is relative to it. */
  startedAt: number;
  note?: string;
  appVersion?: string;
  /** Oldest lines evicted because the capture outgrew its buffer (0 / absent = complete). */
  dropped?: number;
}

const toHex = (bytes: number[]): string =>
  bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** A value on one line: CR/LF runs collapse to a space so a note can't break out of its `#`
 *  comment, and a raw line can't split a row. */
const oneLine = (v: string): string => v.replace(/[\r\n]+/g, ' ').trim();

const relMs = (t: number, startedAt: number): number => Math.max(0, Math.round(t - startedAt));

function headerLines(kind: 'csv' | 'raw', header: CaptureHeader, lines: CapturedLine[]): string[] {
  const frames = lines.filter((l) => l.frame).length;
  const out = [
    `# bolid-tester bus capture (${kind})`,
    `# vehicle: ${oneLine(header.vehicleId) || 'unknown'}`,
    `# protocol: ${oneLine(header.protocol ?? '') || 'unknown'}`,
    `# adapter: ${oneLine(header.adapter ?? '') || 'unknown'}`,
    `# started: ${new Date(header.startedAt).toISOString()}`,
    `# note: ${oneLine(header.note ?? '')}`,
  ];
  if (header.appVersion) out.push(`# app: ${oneLine(header.appVersion)}`);
  out.push(`# lines: ${lines.length} (frames ${frames}, unparsed ${lines.length - frames})`);
  out.push(`# dropped: ${header.dropped ?? 0}`);
  out.push('# t_ms = milliseconds since started');
  return out;
}

/** CSV: header comment lines (`# key: value`) then `t_ms,id,dlc,bytes` — one row per parsed frame,
 *  `bytes` space-separated upper-case hex, `dlc` the number of data bytes printed, `id` empty when
 *  headers were off. Unparsed lines go to a trailing `# raw:` block (`# <t_ms>\t<line>`). */
export function formatCaptureCsv(header: CaptureHeader, lines: CapturedLine[]): string {
  const out = headerLines('csv', header, lines);
  out.push('t_ms,id,dlc,bytes');
  const unparsed: CapturedLine[] = [];
  for (const l of lines) {
    if (!l.frame) {
      unparsed.push(l);
      continue;
    }
    const t = relMs(l.t, header.startedAt);
    out.push(`${t},${l.frame.id ?? ''},${l.frame.bytes.length},${toHex(l.frame.bytes)}`);
  }
  if (unparsed.length) {
    out.push(`# raw: ${unparsed.length} line(s) that did not parse as frames`);
    for (const l of unparsed) out.push(`# ${relMs(l.t, header.startedAt)}\t${oneLine(l.raw)}`);
  }
  return out.join('\n') + '\n';
}

/** Raw dump: the header comments, then one adapter line per row, exactly as printed, prefixed by
 *  `t_ms\t` — parsed or not, in arrival order. */
export function formatCaptureRaw(header: CaptureHeader, lines: CapturedLine[]): string {
  const out = headerLines('raw', header, lines);
  for (const l of lines) out.push(`${relMs(l.t, header.startedAt)}\t${oneLine(l.raw)}`);
  return out.join('\n') + '\n';
}
