/** Text scrubbing for anything that leaves the phone as a diagnostic file: the problem report
 *  (plan 32, `feedbackBundle.ts`) and — later — opt-in crash reports (plan 31, which reuses
 *  `scrubText`). Pure, no imports, so it sits in the core typecheck scope and is unit-tested in
 *  Node. See docs/features/feedback.md → Redaction. */

/** A 17-character VIN (ISO 3779 alphabet: no I, O or Q) standing on its own. */
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
/** A Bluetooth MAC address (Android device id). */
const MAC_RE = /\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi;
/** A UUID (iOS / web Bluetooth device id). */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** An http(s) URL — the AI server address is usually the owner's LAN. */
const URL_RE = /\bhttps?:\/\/[^\s'"<>]+/gi;
/** API keys (`sk-…`, including `sk-ant-…`) and bearer tokens. */
const TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)/g;
/** A latitude, longitude pair with at least four decimals. */
const COORDS_RE = /-?\d{1,2}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g;

/** True for a 17-character string that looks like a VIN: VIN alphabet, at least one letter and at
 *  least one digit (so a long run of digits — a counter, a part number — is not mistaken for one). */
export function looksLikeVin(s: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);
}

/** `looksLikeVin` for a word found in free text, which must also hold a letter outside A–F. A word
 *  of hex digits only is an adapter frame far more often than a VIN: with spaces off (ATS0) and
 *  headers on (ATH1), an 11-bit CAN frame with a 7-byte payload (`7E8064100BE3FA813`) is exactly 17
 *  hex characters. A known VIN (the session's, the garage's, one decoded from a `49 02` reply) is
 *  still masked wherever it occurs by `maskKnownVins`, whatever its letters. */
export function looksLikeVinInText(s: string): boolean {
  return looksLikeVin(s) && /[G-Z]/.test(s);
}

/** `WVWZZZ1KZ9W903398` → `***03398`: the last five characters stay (enough to tell two cars apart
 *  in a report, not enough to identify one). */
export function maskVin(vin: string): string {
  return `***${vin.slice(-5)}`;
}

/** The adapter's device id in a bundle header: a MAC keeps its first three bytes (the maker's
 *  prefix, `AA:BB:CC:**:**:**`); anything else (an iOS / browser UUID, a Wi-Fi address) becomes
 *  `<device-id>`. */
export function maskDeviceId(id: string | null): string | null {
  if (id == null || id === '') return id;
  const mac = /^([0-9A-F]{2}):([0-9A-F]{2}):([0-9A-F]{2})(?::[0-9A-F]{2}){3}$/i.exec(id.trim());
  if (mac) return `${mac[1]}:${mac[2]}:${mac[3]}:**:**:**`.toUpperCase();
  return '<device-id>';
}

/** Every VIN-looking word in a text (`looksLikeVinInText`), deduplicated, in order of appearance. */
export function findVins(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VIN_RE)) {
    if (looksLikeVinInText(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mask the given VINs wherever they occur in `text`, case-insensitively and even inside a longer
 *  word (`scrubText` only catches a VIN standing on its own). */
export function maskKnownVins(text: string, vins: readonly string[]): string {
  let out = text;
  for (const vin of vins) {
    if (vin.length !== 17) continue;
    out = out.replace(new RegExp(escapeRe(vin), 'gi'), maskVin(vin.toUpperCase()));
  }
  return out;
}

export interface ScrubOptions {
  /** Keep VINs and MAC / UUID device ids (the user turned on "Keep VIN and adapter address"). URLs,
   *  API keys, bearer tokens and coordinates are removed either way. */
  keepIdentifiers?: boolean;
}

/** Remove identifiers from free text, in this order: VIN (`looksLikeVinInText`) → `***` + last 5;
 *  MAC / UUID device ids → `<device-id>`; http(s) URLs → `<url>`; API keys and bearer tokens →
 *  `<token>`; GPS coordinate pairs → `<coords>`. With `keepIdentifiers`, the first two steps are
 *  skipped. Idempotent: scrubbing twice gives the same text as scrubbing once. */
export function scrubText(s: string, opts: ScrubOptions = {}): string {
  const ids = opts.keepIdentifiers
    ? s
    : s
        .replace(VIN_RE, (m) => (looksLikeVinInText(m) ? maskVin(m) : m))
        .replace(MAC_RE, '<device-id>')
        .replace(UUID_RE, '<device-id>');
  return ids.replace(URL_RE, '<url>').replace(TOKEN_RE, '<token>').replace(COORDS_RE, '<coords>');
}
