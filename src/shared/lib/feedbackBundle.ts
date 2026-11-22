/** The problem-report bundle (plan 32): everything a maintainer needs to understand a problem —
 *  the error log, the adapter I/O log, app and device info, the active vehicle and the last module
 *  scan — redacted so nothing identifies the car or the adapter unless the user chooses to keep it.
 *  Pure (no React Native, no stores): `features/feedback/hooks/useFeedbackBundle.ts` collects the
 *  input from the stores and hands the result to the share sheet. Nothing here sends anything.
 *  See docs/features/feedback.md. */
import type { ErrorContext, LoggedError } from './errorLog';
import { findVins, looksLikeVin, maskDeviceId, maskKnownVins, maskVin, scrubText } from './scrub';

/** One adapter log line — structurally the `LogEntry` of `shared/state/adapterLog.ts`. */
export interface BundleLogEntry {
  dir: 'tx' | 'rx';
  text: string;
  ts: number;
}

export interface BundleApp {
  version: string;
  build?: string;
  /** `settingsStore.adapterSource`: 'mock' (simulator), 'ble', 'wifi' or 'spp'. */
  adapterSource: string;
  /** `Platform.OS`. */
  platform: string;
  /** `Platform.Version` as text (the Android API level, the iOS version). */
  osVersion: string;
  locale?: string;
}

export interface BundleVehicle {
  profileId: string;
  name: string;
  vin: string | null;
  protocol?: string;
  supportedPidCount?: number;
}

export interface BundleAdapter {
  deviceId: string | null;
  deviceName: string | null;
  version?: string;
}

export interface BundleInput {
  /** The user's own words (may be empty). Never redacted: the user wrote it for the maintainer. */
  description: string;
  app: BundleApp;
  vehicle: BundleVehicle;
  adapter: BundleAdapter;
  /** Newest first, as the error-log store keeps them (capped at 500). */
  errors: LoggedError[];
  /** Chronological snapshot of the adapter log ring buffer (≤ 300 lines). */
  adapterLog: BundleLogEntry[];
  /** `formatAutoScanReport(scans[0])`, or null when no module scan was saved. */
  lastScanReport?: string | null;
  /** Other VINs the bundle may contain (the adapter log's recorded VIN, the garage car's). */
  extraVins?: (string | null | undefined)[];
  /** Keep the VIN and the adapter address. Default false: redact. */
  keepIdentifiers?: boolean;
  /** When the bundle was made (ms); defaults to now. */
  createdAt?: number;
}

/** Bump when the JSON shape changes. */
export const FEEDBACK_BUNDLE_SCHEMA = 1;

export interface FeedbackBundle {
  schema: number;
  createdAt: number;
  redacted: boolean;
  description: string;
  app: BundleApp;
  vehicle: BundleVehicle;
  adapter: BundleAdapter;
  errors: LoggedError[];
  adapterLog: BundleLogEntry[];
  lastScanReport: string | null;
}

/** The repository a prefilled GitHub issue opens on. */
export const FEEDBACK_REPO = 'AlexandruOlariu/bolid_tester';
/** A prefilled issue body is cut to this many characters (before URL encoding)… */
export const ISSUE_BODY_MAX_CHARS = 6000;
/** …and further, until the whole issue URL fits browsers and GitHub comfortably. */
export const ISSUE_URL_MAX_CHARS = 8000;
/** The longest description the screen accepts. */
export const FEEDBACK_DESCRIPTION_MAX = 2000;

// --- Redaction -------------------------------------------------------------------------------------

/** Context keys that never leave the phone (secrets), and keys whose value is an address. */
const SECRET_KEY_RE = /api[-_]?key|secret|token|password|authorization/i;
const URL_KEY_RE = /url|host|endpoint/i;

const HEX_DIGIT_RE = /[0-9A-F]/i;

function decodeAscii(hex: string): string {
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/** One received line reduced to its payload hex digits, so the VIN bytes of a multi-frame reply end
 *  up contiguous: the `0:` / `1:` frame index (headers off), the CAN ID and PCI byte(s) (headers
 *  on — 11-bit `7E8 10 14 …` / `7E8 21 …`, 29-bit `18 DA F1 10 …`), and the K-line `48 6B 10`
 *  header + checksum and `49 02 0N` message prefix are dropped. */
function rxPayloadHex(line: string): string {
  let s = line
    .replace(/^\s*[0-9A-F]{1,2}:/i, '')
    .replace(/[^0-9A-F]/gi, '')
    .toUpperCase();
  let canHeader = false;
  if (s.length % 2 === 1 && /^[0-7]/.test(s)) {
    // An 11-bit CAN ID (3 digits); also strips the headers-off `014` byte-count line.
    s = s.slice(3);
    canHeader = true;
  } else if (/^18D[AB]/.test(s) && s.length >= 10) {
    s = s.slice(8);
    canHeader = true;
  } else if (/^486B[0-9A-F]{2}49020[1-5][0-9A-F]{10}$/.test(s)) {
    // K-line, headers on: header, message prefix, 4 VIN bytes, checksum.
    s = s.slice(6, -2);
  }
  // A first frame carries two PCI bytes (`10 14`), single and consecutive frames one.
  if (canHeader && s.length >= 2) s = s.slice(s[0] === '1' ? 4 : 2);
  // K-line message: `49 02 0N` + 4 VIN bytes.
  if (/^49020[1-5][0-9A-F]{8}$/.test(s)) s = s.slice(6);
  return s;
}

/** VINs carried as ASCII hex in the adapter log's replies (Mode 09 PID 02, `49 02 …`), whatever the
 *  spacing, line framing (`0:` / `1:` multi-frame lines, CAN or K-line headers) or BLE chunking:
 *  the received text is joined, each line reduced to its payload (`rxPayloadHex`), and every
 *  17-byte window that decodes to a VIN-looking string is collected. */
export function findVinsInAdapterLog(log: readonly BundleLogEntry[]): string[] {
  const rx = log
    .filter((e) => e.dir === 'rx')
    .map((e) => e.text)
    .join('');
  const hex = rx
    .split(/[\r\n>]+/)
    .map(rxPayloadHex)
    .join('');
  const found: string[] = [];
  for (let i = 0; i + 34 <= hex.length; i++) {
    // Cheap prefilter: a VIN byte is 0x30–0x5A, so its first hex digit is 3, 4 or 5.
    if (hex[i] < '3' || hex[i] > '5') continue;
    const text = decodeAscii(hex.slice(i, i + 34));
    if (looksLikeVin(text) && !found.includes(text)) found.push(text);
  }
  return found;
}

/** Hex digits a VIN byte may be separated by in the log: frame headers, PCI / sequence bytes,
 *  K-line `48 6B 10 49 02 0N` prefixes and checksums. */
const VIN_BYTE_GAP = 16;

interface Step {
  pos: number;
  parent: Step | null;
}

/** Mask a VIN's ASCII hex inside the adapter log replies: each 17-byte occurrence — contiguous, or
 *  spread over multi-frame lines and BLE chunks with up to `VIN_BYTE_GAP` other hex digits between
 *  two of its bytes — has the digits of its first 12 bytes replaced by `*`, so the frame keeps only
 *  the last five characters, like the masked VIN everywhere else. */
export function maskVinInAdapterLog(log: readonly BundleLogEntry[], vin: string): BundleLogEntry[] {
  if (vin.length !== 17) return log.map((e) => ({ dir: e.dir, text: e.text, ts: e.ts }));
  const chars = log.map((e) => e.text.split(''));
  const stream: { e: number; i: number; d: string }[] = [];
  log.forEach((entry, e) => {
    if (entry.dir !== 'rx') return;
    for (let i = 0; i < entry.text.length; i++) {
      if (HEX_DIGIT_RE.test(entry.text[i])) stream.push({ e, i, d: entry.text[i].toUpperCase() });
    }
  });
  const pairs = [...vin.toUpperCase()].map((c) =>
    c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
  // A byte's two digits are adjacent characters of one entry, or the last and first digit of two
  // consecutive entries (a BLE chunk boundary).
  const byteAt = (p: number, pair: string): boolean => {
    const a = stream[p];
    const b = stream[p + 1];
    if (!a || !b || a.d + b.d !== pair) return false;
    return a.e === b.e ? b.i === a.i + 1 : b.e > a.e;
  };
  let level: Step[] = [];
  for (let p = 0; p + 1 < stream.length; p++) {
    if (byteAt(p, pairs[0])) level.push({ pos: p, parent: null });
  }
  for (let k = 1; k < pairs.length && level.length > 0; k++) {
    const next: Step[] = [];
    const seen = new Set<number>();
    for (const step of level) {
      const from = step.pos + 2;
      for (let q = from; q <= from + VIN_BYTE_GAP && q + 1 < stream.length; q++) {
        if (!seen.has(q) && byteAt(q, pairs[k])) {
          seen.add(q);
          next.push({ pos: q, parent: step });
        }
      }
    }
    level = next;
  }
  for (const last of level) {
    const chain: number[] = [];
    for (let s: Step | null = last; s; s = s.parent) chain.unshift(s.pos);
    for (const pos of chain.slice(0, 12)) {
      for (const ref of [stream[pos], stream[pos + 1]]) chars[ref.e][ref.i] = '*';
    }
  }
  return log.map((e, idx) => ({ dir: e.dir, text: chars[idx].join(''), ts: e.ts }));
}

function redactText(s: string, vins: readonly string[]): string {
  return scrubText(maskKnownVins(s, vins));
}

/** Error context: secret keys (`apiKey`, tokens, passwords) are dropped and address keys
 *  (`baseUrl`, …) become `<url>` whatever the switch says; other text values go through `text`. */
function redactContext(ctx: ErrorContext, text: (s: string) => string): ErrorContext | undefined {
  const out: ErrorContext = {};
  for (const key of Object.keys(ctx).sort()) {
    if (SECRET_KEY_RE.test(key)) continue;
    const v = ctx[key];
    if (typeof v === 'string') {
      out[key] = URL_KEY_RE.test(key) && v !== '' ? '<url>' : text(v);
    } else {
      out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function copyError(e: LoggedError, map: (s: string) => string, ctx?: ErrorContext): LoggedError {
  const out: LoggedError = {
    id: e.id,
    ts: e.ts,
    severity: e.severity,
    source: e.source,
    message: map(e.message),
  };
  if (e.stack) out.stack = map(e.stack);
  if (ctx) out.context = ctx;
  return out;
}

/** Every VIN the input may contain: the vehicle's, the extra ones, any VIN-looking word in the
 *  errors and the scan report, and any VIN carried as hex in the adapter log. */
function collectVins(input: BundleInput): string[] {
  const vins = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v && v.length === 17) vins.add(v.toUpperCase());
  };
  add(input.vehicle.vin);
  for (const v of input.extraVins ?? []) add(v);
  for (const e of input.errors) {
    for (const v of findVins(`${e.message}\n${e.stack ?? ''}`)) add(v);
    for (const value of Object.values(e.context ?? {})) {
      if (typeof value === 'string') for (const v of findVins(value)) add(v);
    }
  }
  for (const v of findVins(input.lastScanReport ?? '')) add(v);
  for (const v of findVinsInAdapterLog(input.adapterLog)) add(v);
  return [...vins];
}

/** Build the bundle. Always, whatever `keepIdentifiers` says:
 *  - error context: secret keys (`apiKey`, tokens, passwords) dropped, address keys (`baseUrl`, …)
 *    → `<url>`;
 *  - every text (messages, stacks, context values, scan report, adapter log, names) loses its
 *    http(s) URLs, API keys / bearer tokens and GPS coordinates (`scrubText`);
 *  - the description is kept as the user wrote it.
 *  Unless `keepIdentifiers` (`redacted: true`), the identifiers go too:
 *  - VIN → `***` + last 5 — in the vehicle, the error messages, stacks and context values, the scan
 *    report, and the ASCII hex of `49 02` VIN replies in the adapter log;
 *  - the adapter's device id → `AA:BB:CC:**:**:**` (a MAC) or `<device-id>`, and MAC / UUID device
 *    ids inside any text → `<device-id>`.
 *  With `keepIdentifiers` (`redacted: false`), only the VIN and the device ids are kept. */
export function redactBundle(input: BundleInput): FeedbackBundle {
  const keep = input.keepIdentifiers === true;
  const vins = keep ? [] : collectVins(input);
  const text = (s: string) =>
    keep ? scrubText(s, { keepIdentifiers: true }) : redactText(s, vins);

  let adapterLog = input.adapterLog.map((e) => ({ dir: e.dir, text: e.text, ts: e.ts }));
  for (const vin of vins) adapterLog = maskVinInAdapterLog(adapterLog, vin);
  adapterLog = adapterLog.map((e) => ({
    ...e,
    text: scrubText(e.text, { keepIdentifiers: keep }),
  }));

  const app: BundleApp = {
    version: input.app.version,
    adapterSource: input.app.adapterSource,
    platform: input.app.platform,
    osVersion: input.app.osVersion,
  };
  if (input.app.build) app.build = input.app.build;
  if (input.app.locale) app.locale = input.app.locale;

  const vin = input.vehicle.vin;
  const vehicle: BundleVehicle = {
    profileId: input.vehicle.profileId,
    name: text(input.vehicle.name),
    vin: vin && !keep ? maskVin(vin.toUpperCase()) : vin,
  };
  if (input.vehicle.protocol) vehicle.protocol = input.vehicle.protocol;
  if (input.vehicle.supportedPidCount !== undefined) {
    vehicle.supportedPidCount = input.vehicle.supportedPidCount;
  }

  const adapter: BundleAdapter = {
    deviceId: keep ? input.adapter.deviceId : maskDeviceId(input.adapter.deviceId),
    deviceName: input.adapter.deviceName == null ? null : text(input.adapter.deviceName),
  };
  if (input.adapter.version) adapter.version = input.adapter.version;

  const errors = input.errors.map((e) => {
    const ctx = e.context ? redactContext(e.context, text) : undefined;
    return copyError(e, text, ctx);
  });

  return {
    schema: FEEDBACK_BUNDLE_SCHEMA,
    createdAt: input.createdAt ?? Date.now(),
    redacted: !keep,
    description: input.description,
    app,
    vehicle,
    adapter,
    errors,
    adapterLog,
    lastScanReport: input.lastScanReport ? text(input.lastScanReport) : null,
  };
}

// --- Rendering -------------------------------------------------------------------------------------

function sortedContext(ctx: ErrorContext): ErrorContext {
  const out: ErrorContext = {};
  for (const k of Object.keys(ctx).sort()) out[k] = ctx[k];
  return out;
}

function iso(ts: number): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString();
}

/** Pretty JSON with a fixed key order (the same bundle always gives the same text). */
export function bundleToJson(b: FeedbackBundle): string {
  const ordered = {
    schema: b.schema,
    createdAt: b.createdAt,
    createdAtIso: iso(b.createdAt),
    redacted: b.redacted,
    description: b.description,
    app: {
      version: b.app.version,
      build: b.app.build ?? null,
      adapterSource: b.app.adapterSource,
      platform: b.app.platform,
      osVersion: b.app.osVersion,
      locale: b.app.locale ?? null,
    },
    vehicle: {
      profileId: b.vehicle.profileId,
      name: b.vehicle.name,
      vin: b.vehicle.vin,
      protocol: b.vehicle.protocol ?? null,
      supportedPidCount: b.vehicle.supportedPidCount ?? null,
    },
    adapter: {
      deviceId: b.adapter.deviceId,
      deviceName: b.adapter.deviceName,
      version: b.adapter.version ?? null,
    },
    errors: b.errors.map((e) => ({
      id: e.id,
      ts: e.ts,
      severity: e.severity,
      source: e.source,
      message: e.message,
      stack: e.stack ?? null,
      context: e.context ? sortedContext(e.context) : null,
    })),
    adapterLog: b.adapterLog.map((e) => ({ ts: e.ts, dir: e.dir, text: e.text })),
    lastScanReport: b.lastScanReport,
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

/** Android API level → release name, for the header ("Android 14 (API 34)"). */
const ANDROID_RELEASES: Record<string, string> = {
  '23': '6.0',
  '24': '7.0',
  '25': '7.1',
  '26': '8.0',
  '27': '8.1',
  '28': '9',
  '29': '10',
  '30': '11',
  '31': '12',
  '32': '12L',
  '33': '13',
  '34': '14',
  '35': '15',
  '36': '16',
};

/** "Android 14 (API 34)", "iOS 17.2", "Web". */
export function platformLabel(platform: string, osVersion: string): string {
  if (platform === 'android') {
    const release = ANDROID_RELEASES[osVersion];
    return release ? `Android ${release} (API ${osVersion})` : `Android (API ${osVersion})`;
  }
  if (platform === 'ios') return `iOS ${osVersion}`;
  if (platform === 'web') return 'Web';
  return `${platform} ${osVersion}`.trim();
}

const SOURCE_LABELS: Record<string, string> = {
  mock: 'Simulator',
  ble: 'Bluetooth LE adapter',
  wifi: 'Wi-Fi adapter',
  spp: 'Classic Bluetooth adapter',
};

/** The adapter source in plain words ("Simulator", "Bluetooth LE adapter", …). */
export function adapterSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${cutAt(t, max - 1)}…` : t;
};

export interface MarkdownOptions {
  /** Newest errors listed (default 10). */
  maxErrors?: number;
  /** Last adapter log lines shown (default 40). */
  maxLogLines?: number;
}

/** A human summary for an issue or a message: a header table, the description, the newest errors,
 *  the last adapter log lines in a code block and — only when there is one — the last module scan
 *  folded in a `<details>` block. */
export function bundleToMarkdown(b: FeedbackBundle, opts: MarkdownOptions = {}): string {
  const maxErrors = opts.maxErrors ?? 10;
  const maxLogLines = opts.maxLogLines ?? 40;
  const lines: string[] = [];
  const adapterParts = [b.adapter.deviceName, b.adapter.version, b.adapter.deviceId].filter(
    (p): p is string => !!p,
  );
  const build = b.app.build ? ` (build ${cell(b.app.build)})` : '';
  const locale = b.app.locale ? ` · ${cell(b.app.locale)}` : '';

  lines.push('## Bolid Tester problem report');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  lines.push(`| Created | ${iso(b.createdAt)} |`);
  lines.push(`| App | ${cell(b.app.version)}${build} |`);
  lines.push(`| Device | ${cell(platformLabel(b.app.platform, b.app.osVersion))}${locale} |`);
  lines.push(`| Adapter source | ${cell(adapterSourceLabel(b.app.adapterSource))} |`);
  lines.push(`| Adapter | ${adapterParts.length > 0 ? cell(adapterParts.join(' · ')) : 'none'} |`);
  lines.push(`| Vehicle | ${cell(b.vehicle.name)} (\`${cell(b.vehicle.profileId)}\`) |`);
  lines.push(`| VIN | ${b.vehicle.vin ? cell(b.vehicle.vin) : 'not read'} |`);
  if (b.vehicle.protocol) lines.push(`| Protocol | ${cell(b.vehicle.protocol)} |`);
  if (b.vehicle.supportedPidCount !== undefined) {
    lines.push(`| Supported PIDs | ${b.vehicle.supportedPidCount} |`);
  }
  lines.push(`| Identifiers | ${b.redacted ? 'removed' : 'kept at the user’s request'} |`);
  lines.push('');

  lines.push('### What happened');
  lines.push('');
  lines.push(b.description.trim() ? b.description.trim() : '_No description._');
  lines.push('');

  const errors = b.errors.slice(0, maxErrors);
  lines.push(
    b.errors.length > errors.length
      ? `### Errors (newest ${errors.length} of ${b.errors.length})`
      : `### Errors (${b.errors.length})`,
  );
  lines.push('');
  if (errors.length === 0) lines.push('_No errors logged._');
  for (const e of errors) {
    lines.push(`- \`${iso(e.ts)}\` **${e.severity}** ${e.source}: ${oneLine(e.message, 300)}`);
  }
  lines.push('');

  const log = b.adapterLog.slice(-maxLogLines);
  lines.push(
    b.adapterLog.length > log.length
      ? `### Adapter log (last ${log.length} of ${b.adapterLog.length} lines)`
      : `### Adapter log (${b.adapterLog.length} lines)`,
  );
  lines.push('');
  if (log.length === 0) {
    lines.push('_Empty._');
  } else {
    lines.push('```text');
    for (const e of log) lines.push(`${e.dir === 'tx' ? '>' : '<'} ${oneLine(e.text, 200)}`);
    lines.push('```');
  }

  if (b.lastScanReport) {
    lines.push('');
    lines.push('<details><summary>Last module scan</summary>');
    lines.push('');
    lines.push('```text');
    lines.push(b.lastScanReport.trimEnd());
    lines.push('```');
    lines.push('');
    lines.push('</details>');
  }
  return lines.join('\n') + '\n';
}

/** Cut a string to `max` UTF-16 units without splitting a surrogate pair (which would make
 *  `encodeURIComponent` throw). Used for the issue body and every `oneLine` cut. */
function cutAt(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

/** `encodeURIComponent` that never throws: a lone surrogate already in the text (an error message
 *  or adapter reply cut somewhere else) becomes U+FFFD instead of a `URIError`. */
function encodeText(s: string): string {
  return encodeURIComponent(
    s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : '�')),
  );
}

const TRUNCATED_NOTE = '\n\n_Summary truncated — the full bundle is attached separately._\n';
const ATTACH_NOTE =
  '\n_Please attach the JSON bundle (Report a problem → Share bundle) for the full logs._\n';

/** The issue / email title: "Problem report: <first line of the description>" (≤ 80 characters). */
export function issueTitle(b: FeedbackBundle): string {
  const first = b.description.trim().split(/\r?\n/)[0] ?? '';
  return first ? `Problem report: ${oneLine(first, 80)}` : `Problem report (app ${b.app.version})`;
}

/** `https://github.com/<repo>/issues/new?title=…&body=…` prefilled with the Markdown summary. The
 *  body is cut to `ISSUE_BODY_MAX_CHARS`, then further until the URL is at most
 *  `ISSUE_URL_MAX_CHARS` long, with a note that the full bundle is attached separately. */
export function issueUrl(b: FeedbackBundle, repo: string = FEEDBACK_REPO): string {
  const base = `https://github.com/${repo}/issues/new?title=${encodeText(issueTitle(b))}&body=`;
  const full = bundleToMarkdown(b) + ATTACH_NOTE;
  const make = (len: number) => {
    const body = len >= full.length ? full : cutAt(full, len) + TRUNCATED_NOTE;
    return base + encodeText(body);
  };
  let len = Math.min(full.length, ISSUE_BODY_MAX_CHARS);
  let url = make(len);
  while (url.length > ISSUE_URL_MAX_CHARS && len > 0) {
    // Shrink in proportion to the overshoot (an encoded character is up to 9 characters long).
    const over = url.length - ISSUE_URL_MAX_CHARS;
    len = Math.max(0, len - Math.max(50, Math.ceil(over / 3)));
    url = make(len);
  }
  return url;
}

/** A `mailto:` draft: subject and a short body (no logs — mail clients choke on long links); the
 *  user attaches the bundle file from the share sheet. */
export function mailtoUrl(b: FeedbackBundle, to: string): string {
  const build = b.app.build ? ` (build ${b.app.build})` : '';
  const body = [
    b.description.trim() || '(No description.)',
    '',
    `App: ${b.app.version}${build} · ${platformLabel(b.app.platform, b.app.osVersion)}`,
    `Vehicle: ${b.vehicle.name}${b.vehicle.vin ? ` · VIN ${b.vehicle.vin}` : ''}`,
    `Errors: ${b.errors.length} · adapter log lines: ${b.adapterLog.length} · last module scan: ${b.lastScanReport ? 'yes' : 'no'}`,
    '',
    'The full report is in the bundle file shared from the app — please attach it to this email.',
  ].join('\n');
  const subject = encodeText(issueTitle(b));
  return `mailto:${encodeURI(to)}?subject=${subject}&body=${encodeText(body)}`;
}

/** UTF-8 size of a text in bytes (the bundle size the screen shows). */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** "812 B", "14.2 KB", "1.3 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
