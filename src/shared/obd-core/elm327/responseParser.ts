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
  bytes: number[];
}

const NOTICE_PATTERNS: { match: RegExp; notice: ElmNotice }[] = [
  { match: /NO\s*DATA/i, notice: 'NO DATA' },
  { match: /UNABLE\s*TO\s*CONNECT/i, notice: 'UNABLE TO CONNECT' },
  { match: /BUS\s*INIT.*ERROR/i, notice: 'BUS INIT ERROR' },
  { match: /CAN\s*ERROR/i, notice: 'CAN ERROR' },
  { match: /BUFFER\s*FULL/i, notice: 'BUFFER FULL' },
  { match: /STOPPED/i, notice: 'STOPPED' },
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

export function parseElmResponse(raw: string): ParsedResponse {
  const text = normalize(raw);
  for (const { match, notice } of NOTICE_PATTERNS) {
    if (match.test(text)) return { raw, notice, bytes: [] };
  }
  if (text === '?' || /(^|\s)\?($|\s)/.test(text)) return { raw, notice: '?', bytes: [] };
  const multiFrame = reassembleIsoTp(raw);
  if (multiFrame) return { raw, notice: null, bytes: multiFrame };
  // 'OK' and other non-hex AT replies yield an empty byte list (no notice).
  return { raw, notice: null, bytes: parseHexBytes(text) };
}
