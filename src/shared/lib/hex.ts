/** Hex <-> byte helpers. Pure, no platform deps. */

/** Parse a hex string (ignoring spaces and any non-hex chars) into a byte array. */
export function parseHexBytes(input: string): number[] {
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return bytes;
}

/** Format a single byte as a 2-char uppercase hex string. */
export function byteToHex(b: number): string {
  return (b & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

/** Format a byte array as uppercase hex, optionally separated. */
export function toHex(bytes: number[] | Uint8Array, sep = ''): string {
  return Array.from(bytes)
    .map((b) => byteToHex(b))
    .join(sep);
}
