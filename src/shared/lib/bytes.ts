/** ASCII <-> byte helpers used to move text over the (byte-oriented) transport. */

/** Encode an ASCII/Latin-1 string to bytes (low 8 bits of each char code). */
export function stringToBytes(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
  return arr;
}

/** Decode bytes to a Latin-1 string. */
export function bytesToString(bytes: Uint8Array | number[]): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** Encode an ASCII string to a plain number[] (used to build simulated VIN frames). */
export function asciiToBytes(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0) & 0xff);
}
