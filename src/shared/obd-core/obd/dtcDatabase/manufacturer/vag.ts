/**
 * VAG (VW / Audi / Škoda / SEAT) manufacturer DTC texts — the single home for both VAG tables.
 * The two tables live in DIFFERENT number spaces and must never be mixed:
 *
 * - `VAG_P1` (from `vag-p1.ts`): manufacturer-specific powertrain codes keyed by the SAE form
 *   (`P1xxx`). Used by `lookupDtc(code, 'vag')` for codes in the manufacturer ranges — this is
 *   what OBD2 Modes 03/07/0A and UDS 0x19 (EDC17 and other CAN/UDS modules) report, because
 *   their two DTC bytes are SAE-encoded.
 * - `VAG_DTC_TEXTS`: native KWP1281 / KWP2000 fault numbers (the VCDS 5-digit "component"
 *   numbers such as 00532 "Supply voltage B+"), as read by KWP `0x18` from pre-UDS modules over
 *   TP2.0 (`tp20/tp20Scan.ts`, `KwpDtc.vag`). These are NOT SAE codes: read as SAE bytes, 00532
 *   would be 0x0214 = P0214 (Cold Start Injector 2) — a different fault. So this table is only
 *   consulted for native KWP faults (`vagNativeDtcText`), never for an SAE-encoded DTC (the UDS
 *   path describes those with `describeDtc(sae, 'vag')`). Moved here from `uds/vagDtcs.ts`
 *   (plan 05); that file re-exports from here.
 *
 * Texts name the component only. VCDS reports the failure type (e.g. "Signal too Low",
 * "No Communications") separately, in the status byte, so a fixed suffix would be wrong for some
 * reads. Entries that are a complete statement on their own (01044, 65535) keep it.
 *
 * Sourcing: widely published VCDS labels / VAG P1 definitions, authored in our own short wording;
 * nothing copied from GPL sources (python-OBD `codes.py` is GPL-2). Confirm against the real
 * module's own text before acting on a repair.
 */
import { VAG_P1 } from './vag-p1';

export { VAG_P1 };

/** Native KWP 5-digit fault number → component text (see the header: not SAE codes). */
export const VAG_DTC_TEXTS: Record<string, string> = {
  '00281': 'Vehicle speed sensor (G68)',
  '00522': 'Engine coolant temperature sensor (G62)',
  '00532': 'Supply voltage B+',
  '00550': 'Start of injection regulation',
  '00575': 'Intake manifold pressure',
  '00668': 'Supply voltage terminal 30',
  '00779': 'Outside air temperature sensor (G17)',
  '00928': 'Locking module for central locking, front driver side (F220)',
  '01044': 'Control module incorrectly coded',
  '01299': 'Diagnostic interface for data bus (J533)',
  '01312': 'Powertrain data bus',
  '01314': 'Engine control module',
  '01330': 'Central control module for central convenience (J393)',
  // Raw 0xFFFF from KWP 0x18 (parseKwpDtcs keeps it); unreachable from an SAE code, by design.
  '65535': 'Internal control module memory error',
};

const LETTERS = ['P', 'C', 'B', 'U'] as const;

/** SAE form of a 5-digit number read as two DTC bytes, e.g. '05463' → 'P1557'; null when not a
 *  2-byte number. Only meaningful for SAE-encoded DTCs (UDS / OBD2), never for native KWP
 *  numbers. Local copy of `decodeDtcBytes` so this data module never imports `obd/dtc.ts` (which
 *  imports the database — no cycle). */
export function saeCodeForVagCode(vagCode: string): string | null {
  if (!/^\d{1,5}$/.test(vagCode)) return null;
  const n = parseInt(vagCode, 10);
  if (n <= 0 || n > 0xffff) return null;
  const b0 = n >> 8;
  const b1 = n & 0xff;
  const hex = (v: number) => v.toString(16).toUpperCase();
  return `${LETTERS[(b0 >> 6) & 0x03]}${(b0 >> 4) & 0x03}${hex(b0 & 0x0f)}${hex(b1 >> 4)}${hex(b1 & 0x0f)}`;
}

/** Component text for a native KWP fault number (TP2.0 module scan), e.g. '532' → 'Supply
 *  voltage B+'; null when unknown. Never use it for an SAE-encoded DTC's VAG number. */
export function vagNativeDtcText(vagCode: string): string | null {
  return VAG_DTC_TEXTS[vagCode.padStart(5, '0')] ?? null;
}

/** @deprecated Compatibility name for `vagNativeDtcText` (pre-plan-05 API). */
export const vagDtcText = vagNativeDtcText;
