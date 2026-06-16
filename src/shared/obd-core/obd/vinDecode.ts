/** VIN (ISO 3779 / 3780) decoding: WMI manufacturer, region & country, model year and check digit.
 *  Pure — it operates on the VIN string assembled by `obd/vin.ts` (Mode 09 PID 02), so it is fully
 *  unit-testable with no hardware. See docs/features/vin-decode.md.
 *
 *  HONESTY: the model-year (char 10) and check-digit (char 9) conventions are **North-American**
 *  (FMVSS 565 / 49 CFR 565). Many rest-of-world manufacturers (incl. VAG/Fiat here) do not encode a
 *  year in char 10 or carry a valid check digit, so each result is flagged for how far to trust it. */

export interface VinCheckDigit {
  expected: string; // the digit we computed for chars {1-8,10-17}
  actual: string; // the actual 9th char
  valid: boolean;
  /** North-American VINs (first char 1-5) MUST carry a valid check digit; most ROW VINs do not. */
  applicable: boolean;
}

export interface DecodedVin {
  vin: string;
  validFormat: boolean; // 17 chars, only legal VIN letters (no I/O/Q)
  wmi: string; // chars 1-3 (World Manufacturer Identifier)
  vds: string; // chars 4-9 (Vehicle Descriptor Section)
  vis: string; // chars 10-17 (Vehicle Identifier Section)
  region: string;
  country: string;
  manufacturer: string;
  modelYear: number | null;
  plantCode: string; // char 11 (manufacturer-defined)
  serial: string; // chars 12-17
  checkDigit: VinCheckDigit;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Model-year code (char 10). The 30 codes repeat every 30 years; the char-7 rule disambiguates. */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/** Decode the model year (char 10). A numeric char-7 ⇒ 1980–2009; an alpha char-7 ⇒ 2010–2039.
 *  Returns null when char 10 is not a valid year code (common on European VINs). */
export function decodeModelYear(vin: string): number | null {
  const idx = YEAR_CODES.indexOf((vin[9] ?? '').toUpperCase());
  if (idx < 0) return null;
  const seventhAlpha = /[A-Z]/.test(vin[6] ?? '');
  return (seventhAlpha ? 2010 : 1980) + idx;
}

// VIN check-digit transliteration (I/O/Q never appear). Letters → 1..9 per FMVSS 565.
const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** Compute the VIN check character (the value that belongs in position 9). 10 maps to 'X'. */
export function computeCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (TRANSLIT[(vin[i] ?? '').toUpperCase()] ?? 0) * WEIGHTS[i];
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

export function vinCheckDigit(vin: string): VinCheckDigit {
  const expected = computeCheckDigit(vin);
  const actual = (vin[8] ?? '').toUpperCase();
  return {
    expected,
    actual,
    valid: expected === actual,
    applicable: /[1-5]/.test(vin[0] ?? ''),
  };
}

// First-char → broad region (ISO 3780).
function regionFor(first: string): string {
  if (/[A-H]/.test(first)) return 'Africa';
  if (/[J-R]/.test(first)) return 'Asia';
  if (/[S-Z]/.test(first)) return 'Europe';
  if (/[1-5]/.test(first)) return 'North America';
  if (/[6-7]/.test(first)) return 'Oceania';
  if (/[8-90]/.test(first)) return 'South America';
  return 'Unknown';
}

// Country by first char, refined by the second char where the first is shared (ISO 3780 ranges).
function countryFor(vin: string): string {
  const a = (vin[0] ?? '').toUpperCase();
  const b = (vin[1] ?? '').toUpperCase();
  const two = a + b;
  const inRange = (lo: string, hi: string) => two >= lo && two <= hi;
  switch (a) {
    case '1': case '4': case '5': return 'United States';
    case '2': return 'Canada';
    case '3': return inRange('3A', '3W') ? 'Mexico' : 'North America';
    case '6': return 'Australia';
    case '9': return inRange('9A', '9E') || inRange('93', '99') ? 'Brazil' : 'South America';
    case 'J': return 'Japan';
    case 'K': return inRange('KL', 'KR') ? 'South Korea' : inRange('KF', 'KK') ? 'Israel' : 'Asia';
    case 'L': return 'China';
    case 'M': return inRange('MA', 'ME') ? 'India' : inRange('MF', 'MK') ? 'Indonesia' : 'Asia';
    case 'S': return inRange('SA', 'SM') ? 'United Kingdom' : inRange('SN', 'ST') ? 'Germany' : inRange('SU', 'SZ') ? 'Poland' : 'Europe';
    case 'T': return inRange('TA', 'TH') ? 'Switzerland' : inRange('TJ', 'TP') ? 'Czech Republic' : inRange('TR', 'TV') ? 'Hungary' : 'Europe';
    case 'V': return inRange('VA', 'VE') ? 'Austria' : inRange('VF', 'VR') ? 'France' : inRange('VS', 'VW') ? 'Spain' : 'Europe';
    case 'W': return 'Germany';
    case 'X': return inRange('XL', 'XR') ? 'Netherlands' : inRange('X0', 'X9') ? 'Russia' : 'Europe';
    case 'Y': return inRange('YA', 'YE') ? 'Belgium' : inRange('YF', 'YK') ? 'Finland' : inRange('YS', 'YW') ? 'Sweden' : 'Europe';
    case 'Z': return inRange('ZA', 'ZR') ? 'Italy' : 'Europe';
    default: return regionFor(a);
  }
}

/** A focused World-Manufacturer-Identifier dictionary (full VAG coverage + common marques). Unknown
 *  WMIs fall back to a country-derived label. Extend as needed — this is data, not logic. */
const WMI: Record<string, string> = {
  WVW: 'Volkswagen', WV1: 'Volkswagen Commercial', WV2: 'Volkswagen Commercial', '1VW': 'Volkswagen', '3VW': 'Volkswagen', '9BW': 'Volkswagen',
  WAU: 'Audi', WUA: 'Audi Sport', WA1: 'Audi', TRU: 'Audi',
  TMB: 'Škoda', VSS: 'SEAT', VSE: 'SEAT',
  WBA: 'BMW', WBS: 'BMW M', WBY: 'BMW i', WMW: 'MINI', '4US': 'BMW', '5UX': 'BMW',
  WDB: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WMX: 'Mercedes-AMG', W1K: 'Mercedes-Benz', W1N: 'Mercedes-Benz', WME: 'smart',
  WP0: 'Porsche', WP1: 'Porsche',
  WF0: 'Ford (Germany)', '1FA': 'Ford', '1FT': 'Ford', '1FM': 'Ford',
  W0L: 'Opel/Vauxhall', W0V: 'Opel/Vauxhall',
  ZFA: 'Fiat', ZFF: 'Ferrari', ZAR: 'Alfa Romeo', ZAM: 'Maserati', ZLA: 'Lancia', ZHW: 'Lamborghini', ZCG: 'Piaggio',
  VF1: 'Renault', VF3: 'Peugeot', VF7: 'Citroën', VF6: 'Renault Trucks', VR1: 'DS Automobiles',
  JHM: 'Honda', '1HG': 'Honda', '19X': 'Honda', JF1: 'Subaru', JF2: 'Subaru',
  JN1: 'Nissan', JN8: 'Nissan', SJN: 'Nissan (UK)',
  JT1: 'Toyota', JT2: 'Toyota', JTD: 'Toyota', JTM: 'Toyota', '4T1': 'Toyota', '5TD': 'Toyota', JTH: 'Lexus',
  KMH: 'Hyundai', KNA: 'Kia', KND: 'Kia', '5XY': 'Hyundai',
  '5YJ': 'Tesla', '7SA': 'Tesla',
  '1G1': 'Chevrolet', '1GC': 'Chevrolet', '2G1': 'Chevrolet', '1GT': 'GMC',
  YV1: 'Volvo', YV4: 'Volvo', VF8: 'DS', SAL: 'Land Rover', SAJ: 'Jaguar', SCC: 'Lotus', SCB: 'Bentley',
};

export function decodeManufacturer(vin: string): string {
  const wmi = vin.slice(0, 3).toUpperCase();
  if (WMI[wmi]) return WMI[wmi];
  // Some small makers share a WMI keyed only on chars 1-2; fall back to country.
  return `Unknown (WMI ${wmi})`;
}

/** Decode a full VIN into its constituent parts. Always returns a structure; `validFormat` says
 *  whether the input was a well-formed 17-char VIN (callers should surface that prominently). */
export function decodeVin(raw: string): DecodedVin {
  const vin = (raw ?? '').toUpperCase().trim();
  const validFormat = VIN_RE.test(vin);
  return {
    vin,
    validFormat,
    wmi: vin.slice(0, 3),
    vds: vin.slice(3, 9),
    vis: vin.slice(9, 17),
    region: regionFor(vin[0] ?? ''),
    country: countryFor(vin),
    manufacturer: decodeManufacturer(vin),
    modelYear: decodeModelYear(vin),
    plantCode: vin[10] ?? '',
    serial: vin.slice(11, 17),
    checkDigit: vinCheckDigit(vin),
  };
}
