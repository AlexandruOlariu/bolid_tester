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

export function parseElmResponse(raw: string): ParsedResponse {
  const text = normalize(raw);
  for (const { match, notice } of NOTICE_PATTERNS) {
    if (match.test(text)) return { raw, notice, bytes: [] };
  }
  if (text === '?' || /(^|\s)\?($|\s)/.test(text)) return { raw, notice: '?', bytes: [] };
  // 'OK' and other non-hex AT replies yield an empty byte list (no notice).
  return { raw, notice: null, bytes: parseHexBytes(text) };
}
