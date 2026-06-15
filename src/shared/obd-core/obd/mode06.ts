/** Mode 06 — On-Board Monitoring Test Results (SAE J1979). The standardized component self-test:
 *  per-monitor test value with min/max bounds and a pass/fail. CAN format decoder.
 *  See docs/features/sensor-tests.md. */

export interface Mode06Result {
  mid: number; // Monitor ID
  tid: number; // Test ID
  value: number; // scaled test value
  min: number; // scaled lower limit
  max: number; // scaled upper limit
  pass: boolean;
  unit: string;
}

/** Minimal subset of the Unit And Scaling ID table (J1979 Appendix). Unknown IDs pass through raw. */
const UAS: Record<number, { scale: number; unit: string; signed?: boolean }> = {
  0x01: { scale: 1, unit: 'count' },
  0x09: { scale: 1, unit: 'rpm' },
  0x0a: { scale: 0.122, unit: 'mV' },
  0x10: { scale: 0.001, unit: 's' },
  0x24: { scale: 1, unit: '' }, // raw counts / ratio placeholder
};

function u16(hi: number, lo: number): number {
  return ((hi << 8) | lo) & 0xffff;
}

function applyScale(uasid: number, raw: number): { value: number; unit: string } {
  const u = UAS[uasid];
  if (!u) return { value: raw, unit: '' };
  return { value: raw * u.scale, unit: u.unit };
}

/** Decode a CAN Mode 06 response. `bytes` includes the `0x46` service byte. Each result group is
 *  7 bytes: MID, TID, UASID, testValue(2), min(2), max(2). */
export function decodeMode06(bytes: number[]): Mode06Result[] {
  if (bytes.length < 1 || bytes[0] !== 0x46) return [];
  const body = bytes.slice(1);
  const out: Mode06Result[] = [];
  for (let i = 0; i + 7 <= body.length; i += 7) {
    const mid = body[i];
    const tid = body[i + 1];
    const uasid = body[i + 2];
    const rawVal = u16(body[i + 3], body[i + 4]);
    const rawMin = u16(body[i + 5], body[i + 6]);
    // Some responses pack max in a following group; when absent, treat min/max from this group.
    const rawMax = i + 9 <= body.length ? u16(body[i + 7], body[i + 8]) : rawMin;
    const v = applyScale(uasid, rawVal);
    const lo = applyScale(uasid, rawMin).value;
    const hi = applyScale(uasid, rawMax).value;
    out.push({
      mid,
      tid,
      value: v.value,
      min: Math.min(lo, hi),
      max: Math.max(lo, hi),
      pass: v.value >= Math.min(lo, hi) && v.value <= Math.max(lo, hi),
      unit: v.unit,
    });
  }
  return out;
}
