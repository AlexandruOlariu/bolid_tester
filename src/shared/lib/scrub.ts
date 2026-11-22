/** Text scrubbing for anything that leaves the phone: the problem report (plan 32,
 *  `feedbackBundle.ts`) and the opt-in crash reports (plan 31: `scrubEvent` / `scrubBreadcrumb`,
 *  the crash service's `beforeSend` / `beforeBreadcrumb`). Pure, no imports, so it sits in the core
 *  typecheck scope and is unit-tested in Node. See docs/features/feedback.md → Redaction and
 *  docs/features/settings.md → Privacy. */

/** A 17-character VIN (ISO 3779 alphabet: no I, O or Q) standing on its own. */
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
/** A Bluetooth MAC address (Android device id). */
const MAC_RE = /\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi;
/** A UUID (iOS / web Bluetooth device id). */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A network address without a scheme (the Wi-Fi adapter's `host:port`, which the TCP transport's
 *  error messages quote): a dotted IPv4 address with or without a port, or a host name followed by a
 *  port. The host name's last label must start with a letter, so a clock time (`12:30`) or an ISO
 *  timestamp (`2026-11-09T12:30:45`) is not taken for one. */
const ADDRESS_RE =
  /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b|\b(?:[A-Za-z0-9-]+\.)*[A-Za-z][A-Za-z0-9-]*:\d{1,5}\b/g;
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
  /** Keep VINs, MAC / UUID device ids and scheme-less network addresses (the user turned on "Keep
   *  VIN and adapter address"). URLs,
   *  API keys, bearer tokens and coordinates are removed either way. */
  keepIdentifiers?: boolean;
}

/** Remove identifiers from free text, in this order: http(s) URLs → `<url>`; VIN
 *  (`looksLikeVinInText`) → `***` + last 5; MAC / UUID device ids → `<device-id>`; a scheme-less
 *  network address (`192.168.0.10:35000`, `obd.local:35000` — the Wi-Fi adapter's) →
 *  `<address>`; API keys and bearer tokens → `<token>`; GPS coordinate pairs → `<coords>`. With
 *  `keepIdentifiers`, the VIN, device-id and address steps are skipped. Idempotent: scrubbing twice gives the same text as scrubbing once. */
export function scrubText(s: string, opts: ScrubOptions = {}): string {
  // URLs first: a URL ends at `<`, so masking its host first would leave the rest of it behind.
  const urls = s.replace(URL_RE, '<url>');
  const ids = opts.keepIdentifiers
    ? urls
    : urls
        .replace(VIN_RE, (m) => (looksLikeVinInText(m) ? maskVin(m) : m))
        .replace(MAC_RE, '<device-id>')
        .replace(UUID_RE, '<device-id>')
        .replace(ADDRESS_RE, '<address>');
  return ids.replace(TOKEN_RE, '<token>').replace(COORDS_RE, '<coords>');
}

// ---------------------------------------------------------------------------------------------
// Crash reports (plan 31)
// ---------------------------------------------------------------------------------------------

/** An e-mail address (the owner's, typed into a server URL or quoted by an error message). */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** The tags a crash report may carry; every other tag is dropped. */
export const CRASH_REPORT_TAGS: readonly string[] = [
  'screen',
  'source',
  'severity',
  'adapterSource',
  'protocol',
];

/** The breadcrumb categories a crash report may carry: screen changes and connection status
 *  changes. Everything else (the crash SDK's own console, fetch, touch and app-lifecycle
 *  breadcrumbs, and never an adapter I/O line) is dropped. */
export const CRASH_BREADCRUMB_CATEGORIES: readonly string[] = ['nav', 'connection'];

/** The keys kept from the crash SDK's device / app contexts: the model and the system, never the
 *  device's name or an id (`device_app_hash`, `id`). `os` is kept whole. */
const DEVICE_KEYS = ['model', 'model_id', 'family', 'manufacturer', 'brand', 'arch', 'simulator'];
const APP_KEYS = ['app_name', 'app_version', 'app_build', 'app_identifier', 'build_type'];

export interface CrashScrubOptions {
  /** VINs known to the app (the connected car's, the garage's): masked wherever they occur, even
   *  where `scrubText`'s word rule would miss them. */
  knownVins?: readonly string[];
}

/** `scrubText` (VIN, device ids, network addresses, URLs, tokens, coordinates) plus e-mail addresses → `<email>` and
 *  the known VINs. Idempotent. */
export function scrubCrashText(s: string, opts: CrashScrubOptions = {}): string {
  const known = opts.knownVins?.length ? maskKnownVins(s, opts.knownVins) : s;
  return scrubText(known).replace(EMAIL_RE, '<email>');
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function pick(src: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!isRecord(src)) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Strings scrubbed, numbers / booleans / null kept, anything nested dropped. */
function scrubFlat(src: unknown, opts: CrashScrubOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isRecord(src)) return out;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string') out[k] = scrubCrashText(v, opts);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

/** A crash breadcrumb as the crash SDK hands it to `beforeBreadcrumb` (only the fields read). */
export interface CrashBreadcrumb {
  category?: string;
  message?: string;
  data?: unknown;
  [key: string]: unknown;
}

/** `beforeBreadcrumb`: null (dropped) unless the category is `nav` or `connection`; a kept one has
 *  its message scrubbed and its `data` removed. Pure: the input is not changed. */
export function scrubBreadcrumb<T extends CrashBreadcrumb>(
  b: T | null | undefined,
  opts: CrashScrubOptions = {},
): T | null {
  if (!b || typeof b.category !== 'string' || !CRASH_BREADCRUMB_CATEGORIES.includes(b.category)) {
    return null;
  }
  const { data: _data, ...rest } = b;
  const out = { ...rest } as T;
  if (typeof b.message === 'string') out.message = scrubCrashText(b.message, opts);
  return out;
}

/** The fields of a crash event that `scrubEvent` reads; everything else passes through. */
export interface CrashEventLike {
  message?: unknown;
  logentry?: unknown;
  exception?: unknown;
  breadcrumbs?: unknown;
  user?: unknown;
  request?: unknown;
  server_name?: unknown;
  contexts?: unknown;
  tags?: unknown;
  extra?: unknown;
}

function scrubException(exception: unknown, opts: CrashScrubOptions): unknown {
  if (!isRecord(exception) || !Array.isArray(exception.values)) return exception;
  return {
    ...exception,
    values: exception.values.map((v: unknown) =>
      isRecord(v) && typeof v.value === 'string'
        ? { ...v, value: scrubCrashText(v.value, opts) }
        : v,
    ),
  };
}

/** `beforeSend`: a copy of the event without anything that identifies the owner, the car or the
 *  adapter:
 *   - `message`, `logentry.message` / `formatted` (its `params` dropped), every
 *     `exception.values[].value`, the `extra` strings and the kept breadcrumbs → `scrubCrashText`;
 *   - breadcrumbs other than `nav` / `connection` dropped (`scrubBreadcrumb`);
 *   - `user`, `request` and `server_name` (the device's name on some systems) removed;
 *   - contexts: only `device` (model, family, maker, architecture — never `name`), `os` and `app`
 *     (name, version, build — never `device_app_hash`);
 *   - tags: only `CRASH_REPORT_TAGS`, values scrubbed.
 *  Pure (the input is not changed) and idempotent. */
export function scrubEvent<T extends CrashEventLike>(e: T, opts: CrashScrubOptions = {}): T {
  const { user: _user, request: _request, server_name: _server, ...rest } = e;
  const out = { ...rest } as T;

  if (typeof e.message === 'string') out.message = scrubCrashText(e.message, opts);
  if (isRecord(e.logentry)) {
    const { params: _params, ...le } = e.logentry;
    if (typeof le.message === 'string') le.message = scrubCrashText(le.message, opts);
    if (typeof le.formatted === 'string') le.formatted = scrubCrashText(le.formatted, opts);
    out.logentry = le;
  }
  if (e.exception !== undefined) out.exception = scrubException(e.exception, opts);
  if (Array.isArray(e.breadcrumbs)) {
    out.breadcrumbs = e.breadcrumbs
      .map((b: unknown) => (isRecord(b) ? scrubBreadcrumb(b as CrashBreadcrumb, opts) : null))
      .filter((b): b is CrashBreadcrumb => b !== null);
  }
  if (e.contexts !== undefined) {
    const c = isRecord(e.contexts) ? e.contexts : {};
    const contexts: Record<string, unknown> = {};
    const device = pick(c.device, DEVICE_KEYS);
    const app = pick(c.app, APP_KEYS);
    if (device) contexts.device = device;
    if (isRecord(c.os)) contexts.os = { ...c.os };
    if (app) contexts.app = app;
    out.contexts = contexts;
  }
  if (e.tags !== undefined) {
    const tags: Record<string, unknown> = {};
    if (isRecord(e.tags)) {
      for (const k of CRASH_REPORT_TAGS) {
        const v = e.tags[k];
        if (typeof v === 'string') tags[k] = scrubCrashText(v, opts);
        else if (typeof v === 'number' || typeof v === 'boolean') tags[k] = v;
      }
    }
    out.tags = tags;
  }
  if (e.extra !== undefined) out.extra = scrubFlat(e.extra, opts);
  return out;
}
