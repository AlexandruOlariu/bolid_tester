/**
 * DTC database (plan 05): description, system, subsystem and a severity hint for every fault code
 * the app can show. Pure and platform-agnostic; bundled statically.
 *
 * Layout
 * - `generic/` — SAE J2012 / ISO 15031-6 standardized codes: P0 (`p0.ts`, composed from parts),
 *   P2 (`p2.ts`), the SAE P34xx block (`p3.ts`), B0, C0 and U0.
 * - `manufacturer/` — OEM-defined codes in the manufacturer ranges, keyed by SAE code: VAG
 *   (`vag.ts`, also the VCDS-style 5-digit table) and Fiat / FGA (`fiat.ts`).
 *
 * Data sourcing rules
 * - Descriptions are the standardized SAE J2012 / ISO 15031-6 definitions (manufacturer files:
 *   the OEM's published meaning), authored for this project in short canonical wording
 *   ("Mass or Volume Air Flow Sensor A Circuit Range/Performance").
 * - Do NOT copy from GPL sources (python-OBD's `codes.py` is GPL-2). If a list is ever used, verify
 *   an MIT/BSD/public-domain licence and cite its URL + licence in that file's header.
 * - One file per family (parts allowed), at most 1 800 lines each; keys upper-case 5-char
 *   (`/^[PCBU][0-9A-F]{4}$/`); no duplicates across files (enforced by `dtcDatabase.test.ts`).
 * - Uncertain codes are omitted rather than guessed: a code without an entry gets a synthesised
 *   description from the range table, `<System> — <subsystem> fault (<code>)`.
 * - Size budget: the whole module at most 350 KB of TS source.
 *
 * This module never imports `obd/dtc.ts` (which re-exports it), so there is no import cycle.
 */
import { P0 } from './generic/p0';
import { P2 } from './generic/p2';
import { P3 } from './generic/p3';
import { B0 } from './generic/b0';
import { C0 } from './generic/c0';
import { U0 } from './generic/u0';
import { VAG_P1 } from './manufacturer/vag';
import { FIAT_P1 } from './manufacturer/fiat';

// ----------------------------------------------------------------------------- types

/** Which manufacturer table to consult for manufacturer-specific codes. */
export type DtcMake = 'vag' | 'fiat' | 'generic';
export type DtcSeverity = 'info' | 'moderate' | 'high' | 'unknown';
export type DtcSystem = 'powertrain' | 'chassis' | 'body' | 'network';

export interface DtcInfo {
  /** Normalised (trimmed, upper-case) code, e.g. 'P0135'. */
  code: string;
  description: string;
  system: DtcSystem;
  /** From the SAE range table, e.g. 'Fuel & air metering', 'Ignition system / misfire'. */
  subsystem: string;
  severity: DtcSeverity;
  /** True in the manufacturer-controlled ranges: P1xxx, P3000–P33FF, B1/B2, C1/C2, U1/U2. */
  manufacturerSpecific: boolean;
  /** Where the description came from; 'range' = no entry, synthesised from the subsystem. */
  source: 'generic' | 'vag' | 'fiat' | 'range';
}

// ------------------------------------------------------------------------ range table

export const DTC_CODE_PATTERN = /^[PCBU][0-9A-F]{4}$/;

const SYSTEM_BY_LETTER: Record<string, DtcSystem> = {
  P: 'powertrain',
  C: 'chassis',
  B: 'body',
  U: 'network',
};

export const DTC_SYSTEM_LABEL: Record<DtcSystem, string> = {
  powertrain: 'Powertrain',
  chassis: 'Chassis',
  body: 'Body',
  network: 'Network',
};

/** One row of the SAE range table: codes starting with `prefix` belong to `subsystem`. The
 *  longest matching prefix wins (see {@link subsystemForCode}). */
export interface DtcRange {
  prefix: string;
  subsystem: string;
}

const FUEL_AIR_AUX = 'Fuel & air metering and auxiliary emission controls';
const FUEL_AIR = 'Fuel & air metering';
const MISFIRE = 'Ignition system / misfire';
const AUX_EMISSION = 'Auxiliary emission controls';
const SPEED_IDLE = 'Vehicle speed, idle control & auxiliary inputs';
const COMPUTER = 'Computer & output circuits';
const TRANSMISSION = 'Transmission';
const HYBRID = 'Hybrid propulsion';
const RESERVED = 'Reserved (ISO/SAE)';
const MANUFACTURER_POWERTRAIN = 'Manufacturer-controlled powertrain';

/** The x-digit grouping J2012 uses for P0xyy — manufacturers follow it for P1xyy too. */
const P0_GROUPS: [string, string][] = [
  ['0', FUEL_AIR_AUX],
  ['1', FUEL_AIR],
  ['2', `${FUEL_AIR} (injector circuit)`],
  ['3', MISFIRE],
  ['4', AUX_EMISSION],
  ['5', SPEED_IDLE],
  ['6', COMPUTER],
  ['7', TRANSMISSION],
  ['8', TRANSMISSION],
  ['9', TRANSMISSION],
  ['A', HYBRID],
  ['B', HYBRID],
  ['C', HYBRID],
  ['D', RESERVED],
  ['E', RESERVED],
  ['F', RESERVED],
];

/** The SAE range table. Exported (and small) so the test can enumerate it. */
export const DTC_RANGES: readonly DtcRange[] = [
  ...P0_GROUPS.map(([x, subsystem]) => ({ prefix: `P0${x}`, subsystem })),
  ...P0_GROUPS.map(([x, subsystem]) => ({ prefix: `P1${x}`, subsystem })),
  // P2xxx: the J2012 generic grouping for the second SAE powertrain block.
  { prefix: 'P20', subsystem: FUEL_AIR_AUX },
  { prefix: 'P21', subsystem: FUEL_AIR_AUX },
  { prefix: 'P22', subsystem: FUEL_AIR_AUX },
  { prefix: 'P23', subsystem: MISFIRE },
  { prefix: 'P24', subsystem: AUX_EMISSION },
  { prefix: 'P25', subsystem: 'Auxiliary inputs' },
  { prefix: 'P26', subsystem: COMPUTER },
  { prefix: 'P27', subsystem: TRANSMISSION },
  { prefix: 'P28', subsystem: TRANSMISSION },
  { prefix: 'P29', subsystem: FUEL_AIR_AUX },
  { prefix: 'P2A', subsystem: FUEL_AIR_AUX },
  { prefix: 'P2B', subsystem: RESERVED },
  { prefix: 'P2C', subsystem: RESERVED },
  { prefix: 'P2D', subsystem: RESERVED },
  { prefix: 'P2E', subsystem: RESERVED },
  { prefix: 'P2F', subsystem: RESERVED },
  // P3xxx: P3000–P33FF manufacturer controlled, P34xx SAE cylinder deactivation, rest reserved.
  { prefix: 'P3', subsystem: RESERVED },
  { prefix: 'P30', subsystem: MANUFACTURER_POWERTRAIN },
  { prefix: 'P31', subsystem: MANUFACTURER_POWERTRAIN },
  { prefix: 'P32', subsystem: MANUFACTURER_POWERTRAIN },
  { prefix: 'P33', subsystem: MANUFACTURER_POWERTRAIN },
  { prefix: 'P34', subsystem: 'Cylinder deactivation / valve control' },
  // Chassis / body: generic (0), manufacturer (1, 2), reserved (3).
  { prefix: 'C0', subsystem: 'Chassis systems (brakes, ABS, stability, steering)' },
  { prefix: 'C1', subsystem: 'Chassis systems (manufacturer-controlled)' },
  { prefix: 'C2', subsystem: 'Chassis systems (manufacturer-controlled)' },
  { prefix: 'C3', subsystem: RESERVED },
  { prefix: 'B0', subsystem: 'Body systems (restraints, occupant sensing)' },
  { prefix: 'B1', subsystem: 'Body systems (manufacturer-controlled)' },
  { prefix: 'B2', subsystem: 'Body systems (manufacturer-controlled)' },
  { prefix: 'B3', subsystem: RESERVED },
  // Network: bus circuits, lost communication, software incompatibility, invalid data.
  { prefix: 'U0', subsystem: 'Network communication' },
  { prefix: 'U00', subsystem: 'Network electrical (bus circuits)' },
  { prefix: 'U01', subsystem: 'Network communication (lost communication)' },
  { prefix: 'U02', subsystem: 'Network communication (lost communication)' },
  { prefix: 'U03', subsystem: 'Network communication (software incompatibility)' },
  { prefix: 'U04', subsystem: 'Network communication (invalid data received)' },
  { prefix: 'U1', subsystem: 'Network communication (manufacturer-controlled)' },
  { prefix: 'U2', subsystem: 'Network communication (manufacturer-controlled)' },
  { prefix: 'U3', subsystem: RESERVED },
];

function normalizeCode(code: string): string {
  return (code ?? '').trim().toUpperCase();
}

/** Subsystem for a normalised code: the longest matching prefix in {@link DTC_RANGES}. */
export function subsystemForCode(code: string): string {
  const c = normalizeCode(code);
  let best: DtcRange | undefined;
  for (const r of DTC_RANGES) {
    if (c.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best?.subsystem ?? 'Unrecognised code range';
}

/** Manufacturer-controlled ranges per J2012: P1xxx, P3000–P33FF, and B/C/U with digit 1 or 2. */
export function isManufacturerSpecific(code: string): boolean {
  const c = normalizeCode(code);
  if (!DTC_CODE_PATTERN.test(c)) return false;
  const d1 = c[1];
  if (c[0] === 'P') return d1 === '1' || (d1 === '3' && '0123'.includes(c[2]));
  return d1 === '1' || d1 === '2';
}

// ---------------------------------------------------------------------- severity rules

/** One severity rule; the first rule whose `pattern` matches the normalised code wins. */
export interface DtcSeverityRule {
  label: string;
  pattern: RegExp;
  severity: 'moderate' | 'high';
}

/** Ordered severity rules (first match). Codes no rule matches are `info` when the database has an
 *  entry and `unknown` when it does not. Exported so the test can enumerate it. */
export const DTC_SEVERITY_RULES: readonly DtcSeverityRule[] = [
  { label: 'Misfire', pattern: /^P03[01][0-9A-F]$/, severity: 'high' },
  { label: 'Hybrid propulsion', pattern: /^P0[AB][0-9A-F]{2}$/, severity: 'high' },
  { label: 'Engine / transmission over temperature', pattern: /^P021[78]$/, severity: 'high' },
  { label: 'Engine oil pressure', pattern: /^P052[0-4]$/, severity: 'high' },
  { label: 'Crankshaft position sensor', pattern: /^P033[56]$/, severity: 'high' },
  { label: 'Lost communication', pattern: /^U01[0-9A-F]{2}$/, severity: 'moderate' },
  { label: 'Catalyst efficiency', pattern: /^P04[23]0$/, severity: 'moderate' },
  { label: 'Emission controls', pattern: /^P04[0-9A-F]{2}$/, severity: 'moderate' },
  {
    label: 'Diesel particulate filter',
    pattern: /^P(200[23]|242F|245[2-9]|246[0-3])$/,
    severity: 'moderate',
  },
  { label: 'Computer & output circuits', pattern: /^P06[0-9A-F]{2}$/, severity: 'moderate' },
];

function severityFor(code: string, hasEntry: boolean): DtcSeverity {
  const rule = DTC_SEVERITY_RULES.find((r) => r.pattern.test(code));
  if (rule) return rule.severity;
  return hasEntry ? 'info' : 'unknown';
}

// --------------------------------------------------------------------------- lookup

/** Generic tables keyed by the code's first two characters. */
const GENERIC_TABLES: Record<string, Record<string, string>> = { P0, P2, P3, B0, C0, U0 };

const MAKE_TABLES: Record<Exclude<DtcMake, 'generic'>, Record<string, string>> = {
  vag: VAG_P1,
  fiat: FIAT_P1,
};

/** Full information for one fault code. Generic codes always resolve from the SAE tables; codes
 *  in the manufacturer ranges resolve from the `make` table, else fall back to the range text. */
export function lookupDtc(code: string, make: DtcMake = 'generic'): DtcInfo {
  const c = normalizeCode(code);
  const system = SYSTEM_BY_LETTER[c[0]] ?? 'powertrain';
  if (!DTC_CODE_PATTERN.test(c)) {
    return {
      code: c,
      description: `Unrecognised fault code (${c || 'empty'})`,
      system,
      subsystem: 'Unrecognised code range',
      severity: 'unknown',
      manufacturerSpecific: false,
      source: 'range',
    };
  }

  const subsystem = subsystemForCode(c);
  const manufacturerSpecific = isManufacturerSpecific(c);
  let description: string | undefined;
  let source: DtcInfo['source'] = 'range';
  if (manufacturerSpecific) {
    if (make !== 'generic') {
      description = MAKE_TABLES[make][c];
      if (description) source = make;
    }
  } else {
    description = GENERIC_TABLES[c.slice(0, 2)]?.[c];
    if (description) source = 'generic';
  }

  return {
    code: c,
    description: description ?? `${DTC_SYSTEM_LABEL[system]} — ${subsystem} fault (${c})`,
    system,
    subsystem,
    severity: severityFor(c, description !== undefined),
    manufacturerSpecific,
    source,
  };
}

/** The display description for a code (= `lookupDtc(code, make).description`). */
export function describeDtc(code: string, make?: DtcMake): string {
  return lookupDtc(code, make).description;
}
