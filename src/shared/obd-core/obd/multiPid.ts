/** CAN multi-PID batching: ISO 15765-4 allows up to 6 Mode 01 PIDs per request, cutting live-data
 *  latency ~3–6× vs one-PID-at-a-time. The response interleaves [pid, data…] per PID; we walk it
 *  with the registry's byte counts. Unknown PIDs abort the walk (structure would be ambiguous) —
 *  the session then falls back to serial polling. CAN only; K-line stays serial. */

import { PID_REGISTRY } from './pids';

export const MAX_PIDS_PER_REQUEST = 6;

export function chunkPids(pids: string[], size = MAX_PIDS_PER_REQUEST): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < pids.length; i += size) chunks.push(pids.slice(i, i + size));
  return chunks;
}

/** Build the batched request, e.g. ['010C','0105'] -> '010C05'. All PIDs must be Mode 01. */
export function buildMultiPidRequest(pids: string[]): string {
  return '01' + pids.map((p) => p.slice(2)).join('');
}

export interface MultiPidEntry {
  pid: string; // '010C'
  data: number[];
}

/** Parse a positive multi-PID response: [0x41, pid, ...data, pid, ...data, …]. Returns null when
 *  the structure cannot be walked safely (unknown PID byte) — callers must fall back to serial. */
export function parseMultiPidResponse(bytes: number[]): MultiPidEntry[] | null {
  if (bytes.length < 2 || bytes[0] !== 0x41) return null;
  const out: MultiPidEntry[] = [];
  let i = 1;
  while (i < bytes.length) {
    const pid = '01' + bytes[i].toString(16).padStart(2, '0').toUpperCase();
    const desc = PID_REGISTRY[pid];
    if (!desc) return out.length ? out : null; // trailing padding OR unknown structure
    const data = bytes.slice(i + 1, i + 1 + desc.bytes);
    if (data.length < desc.bytes) break;
    out.push({ pid, data });
    i += 1 + desc.bytes;
  }
  return out;
}
