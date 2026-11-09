/**
 * Fiat / FGA (Fiat, Alfa Romeo, Lancia) manufacturer-specific powertrain DTC definitions, keyed by
 * the SAE-format code (`P1xxx`).
 *
 * - Manufacturer definitions: `P1xxx` meanings are set by the OEM and differ between the Marelli
 *   IAW (petrol) and Bosch EDC16 / EDC17 Multijet (diesel) control modules Fiat uses, so one code
 *   can mean different things on different engines.
 * - Authored for this project; nothing is copied from GPL sources (e.g. python-OBD `codes.py`,
 *   GPL-2). An entry is added only when its definition is known with confidence. No entry has met
 *   that bar yet, so this table is intentionally empty: Fiat P1xxx codes fall back to the
 *   synthesised range description ("Powertrain — <subsystem> fault (P1xxx)").
 * - Illustrative until confirmed per car: fill this in from the Punto's own module texts
 *   (Multiecuscan / dealer tool session), one entry per confirmed code.
 *
 * License: MIT, authored for bolid-tester (see LICENSE at the repository root).
 */
export const FIAT_P1: Record<string, string> = {};
