/** Supported-PID bitmap encode/decode (PIDs 0100/0120/0140/0160). */

/**
 * Decode a 4-byte supported-PID bitmap into the list of PID request strings it reports.
 * `request` is the bitmap request (e.g. '0120') which sets the base offset.
 * Includes the range-marker pseudo-PIDs (0x20/0x40/0x60) when set; callers filter those.
 */
export function decodeSupportedPids(request: string, data: number[]): string[] {
  const base = parseInt(request.slice(2), 16);
  const bits =
    ((data[0] ?? 0) << 24) | ((data[1] ?? 0) << 16) | ((data[2] ?? 0) << 8) | (data[3] ?? 0);
  const result: string[] = [];
  for (let i = 0; i < 32; i++) {
    if ((bits & (0x80000000 >>> i)) !== 0) {
      const pidNum = base + i + 1;
      result.push('01' + pidNum.toString(16).toUpperCase().padStart(2, '0'));
    }
  }
  return result;
}

/**
 * Encode a list of supported PID numbers (0x01..0x60) into the 4-byte bitmap for `request`.
 * Sets the range-marker bit (0x20/0x40/0x60) when any supported PID lies beyond this range, so a
 * client walking the ranges reaches them all (even across an empty middle range).
 */
export function encodeSupportedPids(request: string, supportedPidNums: number[]): number[] {
  const base = parseInt(request.slice(2), 16);
  let bits = 0;
  for (let i = 1; i <= 32; i++) {
    const pidNum = base + i;
    const isMarker = pidNum % 0x20 === 0;
    const set = isMarker
      ? supportedPidNums.some((n) => n > pidNum)
      : supportedPidNums.includes(pidNum);
    if (set) bits |= 0x80000000 >>> (i - 1);
  }
  return [(bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff];
}
