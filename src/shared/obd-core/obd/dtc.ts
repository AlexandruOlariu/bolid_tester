/** Diagnostic Trouble Code (DTC) encoding/decoding. See docs/obd2-reference.md. */

import { describeDtc, type DtcMake } from './dtcDatabase';

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
 * Manufacturer cross-reference for VAG (VW / Audi / Škoda / SEAT): the 5-digit fault number printed
 * by VCDS and OBD2 apps is simply the DTC's two raw bytes read as a decimal number — the same bytes
 * encodeDtc()/decodeDtcBytes() use. e.g. P2183 -> 0x21 0x83 -> 0x2183 -> 8579 -> "08579".
 *
 * Verified against a real Car Scanner OBD2 export of a VW Golf, which printed the identical hex for
 * both forms: P2183=08579, P2015=08213, P0121=000289 (VCDS pads to 6, here normalised to the natural
 * 2-byte width of 5). Only meaningful for VAG cars and for the classic 2-byte powertrain DTCs the
 * engine ECU exposes over generic OBD2. Returns '' for the empty/padding code.
 */
export function vagCodeForDtc(code: string): string {
  // Powertrain (P) codes only — without this guard a C/B/U code yields a bogus 5-digit "VAG" number.
  if (!code || code[0].toUpperCase() !== 'P') return '';
  const [b0, b1] = encodeDtc(code);
  return ((b0 << 8) | b1).toString().padStart(5, '0');
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

/** Descriptions come from the DTC database (`./dtcDatabase`, plan 05): `describeDtc(code, make?)`
 *  and the richer `lookupDtc(code, make?)` (system, subsystem, severity, manufacturer flag). */
export * from './dtcDatabase';

/** A decoded code with its display description. `make` selects the manufacturer table for
 *  manufacturer-specific codes (P1xxx etc.); generic codes ignore it. */
export function toDtc(code: string, make?: DtcMake): Dtc {
  return { code, description: describeDtc(code, make) };
}
