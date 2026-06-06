/** VIN (Mode 09 PID 02) assembly. See docs/obd2-reference.md. */

// Valid VIN characters exclude I, O and Q.
const VIN_CHAR = /[^A-HJ-NPR-Z0-9]/g;

/**
 * Parse the bytes of a `0902` response into a VIN. Strips the repeated `49 02` service/PID markers
 * and any frame/count bytes (they fall away as non-VIN characters), then takes the first 17 valid
 * VIN characters.
 */
export function parseVin(responseBytes: number[]): string {
  const payload: number[] = [];
  let i = 0;
  while (i < responseBytes.length) {
    if (responseBytes[i] === 0x49 && responseBytes[i + 1] === 0x02) {
      i += 2;
      continue;
    }
    payload.push(responseBytes[i]);
    i += 1;
  }
  const text = payload.map((b) => String.fromCharCode(b)).join('');
  return text.replace(VIN_CHAR, '').slice(0, 17);
}
