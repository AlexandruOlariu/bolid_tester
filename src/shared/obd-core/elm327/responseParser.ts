/** Turn a raw ELM327 response string into either a notice or a list of data bytes. */

import { parseHexBytes } from '../../lib/hex';

export type ElmNotice =
  | 'NO DATA'
  | 'UNABLE TO CONNECT'
  | 'STOPPED'
  | 'BUFFER FULL'
  | 'CAN ERROR'
  | 'BUS INIT ERROR'
  | 'ERROR'
  | '?';

export interface ParsedResponse {
  raw: string;
  notice: ElmNotice | null;
  /** Data bytes of the PRIMARY (first) response frame — see `frames`. Back-compat decision: for the
   *  common single-ECU reply this is the whole response, so every existing single-frame caller is
   *  unchanged. On a MULTI-ECU (functional, headers-off) reply, `bytes` is the FIRST responding
   *  ECU's frame — never the concatenation of all ECUs, which is what fabricated phantom bytes/DTCs.
   *  Multi-ECU-aware callers (readDtcs, discoverSupportedPids) read `frames` instead.
   *  Invariant: `bytes === (frames[0] ?? [])`. */
  bytes: number[];
  /** Every response frame, one array per plain hex line. A single-frame reply — including a
   *  reassembled ISO-TP message, which is ONE logical message from ONE ECU — yields a single
   *  element; a functional request answered by several ECUs (Mode 03 / `0100` on engine+aux cars)
   *  yields one element per ECU. Empty for notices, `?`, and non-hex AT replies (`OK`). */
  frames: number[][];
}

const NOTICE_PATTERNS: { match: RegExp; notice: ElmNotice }[] = [
  { match: /NO\s*DATA/i, notice: 'NO DATA' },
  { match: /UNABLE\s*TO\s*CONNECT/i, notice: 'UNABLE TO CONNECT' },
  { match: /BUS\s*INIT.*ERROR/i, notice: 'BUS INIT ERROR' },
  { match: /CAN\s*ERROR/i, notice: 'CAN ERROR' },
  { match: /BUFFER\s*FULL/i, notice: 'BUFFER FULL' },
  { match: /STOPPED/i, notice: 'STOPPED' },
  // Generic catch-all — MUST stay last so the specific patterns above win. Covers bare `ERROR`,
  // `DATA ERROR`, `<RX ERROR`, `FB ERROR`, etc. Without it these fall through to hex parsing, where
  // the letters that happen to be hex (D, A, E, …) fabricate phantom data bytes and phantom DTCs.
  { match: /\bERROR\b/i, notice: 'ERROR' },
];

/** Remove the prompt, transient notices, and collapse whitespace. */
function normalize(raw: string): string {
  return raw
    .replace(/SEARCHING\.\.\./gi, ' ')
    .replace(/BUS\s*INIT:?/gi, ' ')
    .replace(/>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

/** An ISO-TP segment line as a real ELM327 prints reassembled multi-frame responses:
 *  `0: 49 02 01 31 44 34` (spaces on) or `0:490201314434` (spaces off). The single-hex-digit
 *  counter wraps F -> 0 on long messages. */
const SEGMENT_LINE = /^([0-9A-F])\s*:\s*([0-9A-F\s]+)$/i;

/** A bare hex length line (`014` = 20 bytes) the ELM327 prints before the first segment. */
const LENGTH_LINE = /^[0-9A-F]{2,4}$/i;

/** Reassemble an ELM327 multi-frame (ISO 15765-2) printout into its payload bytes.
 *
 *  Responses longer than 7 bytes — module ident strings, `19 02` with several DTCs, `19 04`
 *  snapshots, VIN — are printed by a real adapter as a hex length line followed by `N:`-prefixed
 *  segment lines. Naive hex-stripping would swallow the length digits and segment counters INTO
 *  the payload, garbling every multi-frame response (the simulator used to answer in one plain
 *  line, which is why tests never caught it — it now prints the real format).
 *
 *  Returns null when no segment lines are present (single-frame responses are untouched).
 *  Non-segment lines around the segments (e.g. interleaved `7F xx 78` response-pending echoes)
 *  are dropped — only the reassembled message survives, which is what callers want. The length
 *  line, when present, truncates clone padding off the last frame. */
export function reassembleIsoTp(raw: string): number[] | null {
  const lines = raw
    .replace(/SEARCHING\.\.\./gi, '')
    .split(/[\r\n]+/)
    .map((l) => l.replace(/>/g, ' ').trim())
    .filter(Boolean);

  const segments: string[] = [];
  let expectedLength: number | null = null;
  for (const line of lines) {
    const seg = SEGMENT_LINE.exec(line);
    if (seg) {
      segments.push(seg[2].replace(/\s+/g, ''));
    } else if (segments.length === 0 && LENGTH_LINE.test(line)) {
      expectedLength = parseInt(line, 16); // the last bare hex line before segment 0
    }
  }
  if (segments.length === 0) return null;

  const bytes = parseHexBytes(segments.join(''));
  if (expectedLength !== null && expectedLength > 0 && expectedLength <= bytes.length) {
    return bytes.slice(0, expectedLength);
  }
  return bytes;
}

/** Split a raw response into per-line data frames — one entry per plain hex line. Non-hex progress
 *  / status lines (`SEARCHING...`, `BUS INIT: OK`, a bare `OK`, stray prompts) are dropped, exactly
 *  as `normalize()` strips them on the single-byte path, so they can never fabricate hex bytes.
 *
 *  Runs ONLY after the ISO-TP reassembly path has been ruled out, so `N:`-prefixed segment lines
 *  and their length line never reach here: a single ECU's >7-byte answer is one reassembled
 *  message (handled by reassembleIsoTp), whereas several PLAIN hex lines mean several ECUs answered
 *  the same functional (broadcast) request with headers off — the real-adapter multi-ECU format
 *  the simulator now emits (see MockTransport / docs/simulator.md). */
function splitDataFrames(raw: string): number[][] {
  const frames: number[][] = [];
  const lines = raw
    .replace(/SEARCHING\.\.\./gi, '\n')
    .replace(/BUS\s*INIT:?/gi, '\n')
    .replace(/>/g, ' ')
    .split(/[\r\n]+/);
  for (const line of lines) {
    const cleaned = line.replace(/\s+/g, '');
    // Only pure-hex lines carrying at least one whole byte are data frames — this drops `OK`, any
    // leftover notice words, and a stray odd nibble a clone might emit.
    if (cleaned.length < 2 || !/^[0-9A-Fa-f]+$/.test(cleaned)) continue;
    frames.push(parseHexBytes(line));
  }
  return frames;
}

export function parseElmResponse(raw: string): ParsedResponse {
  // Classify notices on a lightly-cleaned copy that KEEPS notice words: normalize() strips
  // "BUS INIT" (so the "BUS" letters can't fabricate hex on the data path), which would otherwise
  // hide a "BUS INIT ERROR" and let it be mis-read as an empty, successful response.
  const noticeText = raw
    .replace(/SEARCHING\.\.\./gi, ' ')
    .replace(/>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  for (const { match, notice } of NOTICE_PATTERNS) {
    if (match.test(noticeText)) return { raw, notice, bytes: [], frames: [] };
  }
  const text = normalize(raw);
  if (text === '?' || /(^|\s)\?($|\s)/.test(text)) return { raw, notice: '?', bytes: [], frames: [] };
  const multiFrame = reassembleIsoTp(raw);
  // A reassembled ISO-TP response is ONE logical message (one ECU's >7-byte answer), so it is a
  // single frame — never split per segment line.
  if (multiFrame) return { raw, notice: null, bytes: multiFrame, frames: [multiFrame] };
  // Plain hex line(s): one frame per line. Single-ECU → one frame (bytes === it); multi-ECU
  // functional reply → one frame per responding ECU. 'OK'/non-hex AT replies → no frames, [] bytes.
  const frames = splitDataFrames(raw);
  return { raw, notice: null, bytes: frames[0] ?? [], frames };
}
