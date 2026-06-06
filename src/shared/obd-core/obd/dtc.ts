/** Diagnostic Trouble Code (DTC) encoding/decoding. See docs/obd2-reference.md. */

export interface Dtc {
  code: string; // e.g. 'P0299'
  description: string;
}

const DTC_LETTERS = ['P', 'C', 'B', 'U'] as const;
const LETTER_TO_INDEX: Record<string, number> = { P: 0, C: 1, B: 2, U: 3 };

/** Decode a 2-byte DTC to its string form, or '' for the 00 00 padding. */
export function decodeDtcBytes(b0: number, b1: number): string {
  if (b0 === 0 && b1 === 0) return '';
  const letter = DTC_LETTERS[(b0 >> 6) & 0x03];
  const d1 = ((b0 >> 4) & 0x03).toString();
  const d2 = (b0 & 0x0f).toString(16).toUpperCase();
  const d3 = ((b1 >> 4) & 0x0f).toString(16).toUpperCase();
  const d4 = (b1 & 0x0f).toString(16).toUpperCase();
  return `${letter}${d1}${d2}${d3}${d4}`;
}

/** Encode a DTC string (e.g. 'P0299') back to its 2 bytes. */
export function encodeDtc(code: string): [number, number] {
  const l = LETTER_TO_INDEX[code[0]?.toUpperCase()] ?? 0;
  const d1 = parseInt(code[1] ?? '0', 16) & 0x03;
  const d2 = parseInt(code[2] ?? '0', 16) & 0x0f;
  const d3 = parseInt(code[3] ?? '0', 16) & 0x0f;
  const d4 = parseInt(code[4] ?? '0', 16) & 0x0f;
  return [(l << 6) | (d1 << 4) | d2, (d3 << 4) | d4];
}

/**
 * Parse the DTC payload of a Mode 03/07/0A response, AFTER the service byte is removed.
 * Handles both the CAN style (leading count byte → odd length) and the K-line style
 * (2-byte pairs with 00 00 padding → even length).
 */
export function parseDtcBytes(dataAfterService: number[]): string[] {
  let bytes = dataAfterService;
  if (bytes.length % 2 === 1) bytes = bytes.slice(1); // drop CAN count byte
  const codes: string[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = decodeDtcBytes(bytes[i], bytes[i + 1]);
    if (code) codes.push(code);
  }
  return codes;
}

/** A small dictionary of common generic codes; unknown codes get a range-based label. */
const DTC_DICTIONARY: Record<string, string> = {
  P0101: 'Mass air flow (MAF) circuit range/performance',
  P0113: 'Intake air temperature sensor circuit high',
  P0128: 'Coolant thermostat (below regulating temperature)',
  P0131: 'O2 sensor circuit low voltage (B1S1)',
  P0133: 'O2 sensor circuit slow response (B1S1)',
  P0171: 'System too lean (Bank 1)',
  P0172: 'System too rich (Bank 1)',
  P0234: 'Turbocharger overboost condition',
  P0299: 'Turbocharger/supercharger underboost',
  P0300: 'Random/multiple cylinder misfire detected',
  P0301: 'Cylinder 1 misfire detected',
  P0401: 'Exhaust gas recirculation (EGR) flow insufficient',
  P0402: 'Exhaust gas recirculation (EGR) flow excessive',
  P0420: 'Catalyst system efficiency below threshold (Bank 1)',
  P0500: 'Vehicle speed sensor malfunction',
  P0606: 'ECM/PCM processor fault',
  P2002: 'Diesel particulate filter efficiency below threshold (Bank 1)',
  U0100: 'Lost communication with ECM/PCM',
};

const SYSTEM_NAME: Record<string, string> = {
  P: 'Powertrain',
  C: 'Chassis',
  B: 'Body',
  U: 'Network',
};

export function describeDtc(code: string): string {
  if (DTC_DICTIONARY[code]) return DTC_DICTIONARY[code];
  const system = SYSTEM_NAME[code[0]] ?? 'Unknown';
  return `${system} code ${code} (generic — no local description)`;
}

export function toDtc(code: string): Dtc {
  return { code, description: describeDtc(code) };
}
