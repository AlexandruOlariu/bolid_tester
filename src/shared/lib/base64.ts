/** Minimal base64 <-> bytes, used by the BLE transport (react-native-ble-plx exchanges base64).
 *  Dependency-free so it is unit-testable in the core. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i;

export function bytesToBase64(input: number[] | Uint8Array): string {
  const bytes = Array.from(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = LOOKUP[clean[i]] ?? 0;
    const c1 = LOOKUP[clean[i + 1]] ?? 0;
    const c2 = clean[i + 2] !== undefined ? LOOKUP[clean[i + 2]] : undefined;
    const c3 = clean[i + 3] !== undefined ? LOOKUP[clean[i + 3]] : undefined;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) {
      bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
      if (c3 !== undefined) bytes.push(((c2 & 0x03) << 6) | c3);
    }
  }
  return bytes;
}
