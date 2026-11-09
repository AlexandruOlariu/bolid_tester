/** The app backup bundle (plan 18): every persisted store's zustand envelope plus the trip CSV
 *  files, in **one plain JSON file** the user keeps anywhere. Pure — no React Native, no file system
 *  — so the format, validation, redaction and restore plan are unit-tested in the core project; the
 *  file I/O and the store registry live in `src/features/backup`. See docs/features/backup.md.
 *
 *  Why one JSON and no zip: every payload is text (zustand JSON + trip CSV), so a JSON bundle is
 *  lossless, readable in a text editor, shareable through any channel and needs no native module.
 *  The file is **not encrypted**: it holds VINs and the whole history, but never an API key (those
 *  live in the OS keystore; `redactBackup` also blanks a legacy key a blob might still carry). */

export const BACKUP_FORMAT = 1 as const;

/** One store as saved: its persist key, the data version it was written with, its state. */
export interface BackupStoreBlob {
  name: string;
  version: number;
  state: unknown;
}

/** One trip's samples file (`trip-<id>.csv`). */
export interface BackupTripFile {
  id: string;
  csv: string;
}

export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  createdAt: number;
  app: { version: string | null; platform: string };
  stores: BackupStoreBlob[];
  tripFiles?: BackupTripFile[];
  /** Sizes for the UI estimate; computed on build. */
  sizes: { storesBytes: number; tripBytes: number };
}

/** A store file as read from disk: its contents, or null when the store never wrote one. */
export interface RawStoreFile {
  name: string;
  raw: string | null;
}

/** Above this estimated bundle size the backup screen warns that the file is large (trip
 *  recordings dominate). 50 MB in SI units, the units `formatBytes` shows. */
export const LARGE_BACKUP_BYTES = 50_000_000;

/** A trip id that is safe to put in a file name: no path separators, no `..`. */
const SAFE_TRIP_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** UTF-8 byte length of a string (what the file will weigh), without TextEncoder (not in every JS
 *  engine the app runs on). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4; // surrogate pair = one 4-byte code point
      i++;
    } else n += 3;
  }
  return n;
}

/** Parse a zustand-persist file (`{"state": …, "version": n}`). Tolerant: a missing version is 0
 *  (what zustand assumes for a store declared without one); anything that is not such an envelope
 *  is null. */
export function parseEnvelope(raw: string): { state: unknown; version: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !('state' in parsed)) return null;
  const version = typeof parsed.version === 'number' ? parsed.version : 0;
  return { state: parsed.state, version };
}

/** The file contents zustand-persist reads back for `blob`. */
export function envelopeFor(blob: BackupStoreBlob): string {
  return JSON.stringify({ state: blob.state, version: blob.version });
}

/** Build a bundle from the store files read off disk (absent or unreadable ones are skipped) and
 *  the trip CSVs. Sizes are the bytes of the inputs, for the UI estimate. */
export function buildBackup(
  files: RawStoreFile[],
  tripFiles: BackupTripFile[],
  app: BackupBundle['app'],
  now: number = Date.now(),
): BackupBundle {
  const stores: BackupStoreBlob[] = [];
  let storesBytes = 0;
  for (const f of files) {
    if (f.raw === null) continue;
    const env = parseEnvelope(f.raw);
    if (!env) continue;
    stores.push({ name: f.name, version: env.version, state: env.state });
    storesBytes += utf8Bytes(f.raw);
  }
  const tripBytes = tripFiles.reduce((sum, t) => sum + utf8Bytes(t.csv), 0);
  return {
    format: BACKUP_FORMAT,
    createdAt: now,
    app,
    stores,
    ...(tripFiles.length > 0 ? { tripFiles } : {}),
    sizes: { storesBytes, tripBytes },
  };
}

const SECRET_KEY = /^api[-_]?key$/i;

/** Blank every non-empty `apiKey` in `x`, returning the SAME object when there was none (so a blob
 *  without a secret stays byte-identical). */
function scrubSecrets(x: unknown): unknown {
  if (Array.isArray(x)) {
    let changed = false;
    const out = x.map((v) => {
      const s = scrubSecrets(v);
      if (s !== v) changed = true;
      return s;
    });
    return changed ? out : x;
  }
  if (!isRecord(x)) return x;
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(x)) {
    const next = SECRET_KEY.test(k) && typeof v === 'string' && v !== '' ? '' : scrubSecrets(v);
    if (next !== v) {
      out ??= { ...x };
      out[k] = next;
    }
  }
  return out ?? x;
}

/** `redactBackup` for one store's state (the per-store JSON export). */
export function redactState(state: unknown): unknown {
  return scrubSecrets(state);
}

/** Remove secrets from a bundle: a legacy `bolid.settings` blob (pre keystore) may still carry the
 *  AI `apiKey` in plain text. Every `apiKey` found is blanked to '' (the shape the settings store
 *  itself writes); blobs without one are returned untouched. Applied when a backup is built **and**
 *  before one is restored, so a hand-edited file cannot plant a key either. */
export function redactBackup(b: BackupBundle): BackupBundle {
  let changed = false;
  const stores = b.stores.map((blob) => {
    const state = scrubSecrets(blob.state);
    if (state === blob.state) return blob;
    changed = true;
    return { ...blob, state };
  });
  return changed ? { ...b, stores } : b;
}

export type BackupValidation =
  | { ok: true; bundle: BackupBundle; warnings: string[] }
  | { ok: false; reason: string };

/** Check that `x` (a parsed file) is a backup this app can read. Hard errors: not an object, a
 *  `format` other than 1, no `stores` array, a store without a string name, a numeric version or a
 *  state. Soft (warnings, the rest still restores): an unknown store name (a newer app's data, or a
 *  store this build dropped), a duplicate store (the first wins), a malformed or unsafe trip file. */
export function validateBackup(x: unknown, known: string[]): BackupValidation {
  if (!isRecord(x)) return { ok: false, reason: 'This file is not a Bolid backup.' };
  if (x.format !== BACKUP_FORMAT) {
    return typeof x.format === 'number'
      ? {
          ok: false,
          reason: `This backup uses format ${x.format}; this app reads format ${BACKUP_FORMAT}. Update the app to restore it.`,
        }
      : { ok: false, reason: 'This file is not a Bolid backup.' };
  }
  if (!Array.isArray(x.stores)) return { ok: false, reason: 'The backup has no list of stores.' };
  const warnings: string[] = [];
  const knownSet = new Set(known);
  const seen = new Set<string>();
  const stores: BackupStoreBlob[] = [];
  for (const s of x.stores) {
    if (!isRecord(s) || typeof s.name !== 'string' || !s.name) {
      return { ok: false, reason: 'A store in the backup has no name.' };
    }
    if (typeof s.version !== 'number' || !Number.isInteger(s.version) || s.version < 0) {
      return { ok: false, reason: `The store ${s.name} has no valid data version.` };
    }
    if (!('state' in s)) return { ok: false, reason: `The store ${s.name} has no data.` };
    if (seen.has(s.name)) {
      warnings.push(`${s.name} appears twice; the first copy is used.`);
      continue;
    }
    seen.add(s.name);
    if (!knownSet.has(s.name)) warnings.push(`${s.name} is not known to this app and is ignored.`);
    stores.push({ name: s.name, version: s.version, state: s.state });
  }
  let tripFiles: BackupTripFile[] | undefined;
  if (x.tripFiles !== undefined) {
    if (!Array.isArray(x.tripFiles)) {
      warnings.push('The trip recordings list is malformed and is ignored.');
    } else {
      tripFiles = [];
      let dropped = 0;
      for (const t of x.tripFiles) {
        if (
          isRecord(t) &&
          typeof t.id === 'string' &&
          SAFE_TRIP_ID.test(t.id) &&
          typeof t.csv === 'string'
        ) {
          tripFiles.push({ id: t.id, csv: t.csv });
        } else dropped++;
      }
      if (dropped > 0) warnings.push(`${dropped} trip recording(s) are malformed and are ignored.`);
    }
  }
  const app = isRecord(x.app) ? x.app : {};
  const sizes = isRecord(x.sizes) ? x.sizes : {};
  const bundle: BackupBundle = {
    format: BACKUP_FORMAT,
    createdAt: typeof x.createdAt === 'number' ? x.createdAt : 0,
    app: {
      version: typeof app.version === 'string' ? app.version : null,
      platform: typeof app.platform === 'string' ? app.platform : 'unknown',
    },
    stores,
    ...(tripFiles ? { tripFiles } : {}),
    sizes: {
      storesBytes: typeof sizes.storesBytes === 'number' ? sizes.storesBytes : 0,
      tripBytes:
        typeof sizes.tripBytes === 'number'
          ? sizes.tripBytes
          : (tripFiles ?? []).reduce((n, t) => n + utf8Bytes(t.csv), 0),
    },
  };
  return { ok: true, bundle, warnings };
}

/** Parse + validate a backup file's text. */
export function parseBackup(text: string, known: string[]): BackupValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This file is not a Bolid backup (it is not valid JSON).' };
  }
  return validateBackup(parsed, known);
}

/** The file size the bundle will have once written (as `JSON.stringify(b, null, 2)`). */
export function estimateBundleBytes(b: BackupBundle): number {
  return utf8Bytes(serializeBackup(b));
}

/** The text written to the backup file: indented, so it reads in a text editor. */
export function serializeBackup(b: BackupBundle): string {
  return JSON.stringify(b, null, 2);
}

/** `yyyymmdd-hhmm` in UTC — sorts chronologically as a plain string. */
export function backupStamp(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/** `bolid-backup-<yyyymmdd-hhmm>.json` (UTC, so file names sort by date). */
export function backupFileName(now: number): string {
  return `bolid-backup-${backupStamp(now)}.json`;
}

/** The automatic snapshot taken before a restore: `pre-restore-<yyyymmdd-hhmm>.json`. */
export function preRestoreFileName(now: number): string {
  return `pre-restore-${backupStamp(now)}.json`;
}

const PRE_RESTORE_NAME = /^pre-restore-(\d{8}-\d{4})(?:-(\d+))?\.json$/;

/** The pre-restore snapshots to delete so only the newest `keep` remain. Newest = latest stamp,
 *  then the highest `-<n>` suffix (a second snapshot in the same minute). Other files are ignored. */
export function preRestoreFilesToDelete(names: string[], keep = 3): string[] {
  const snaps = names
    .map((name) => {
      const m = PRE_RESTORE_NAME.exec(name);
      return m ? { name, stamp: m[1], n: m[2] ? Number(m[2]) : 1 } : null;
    })
    .filter((x): x is { name: string; stamp: string; n: number } => x !== null)
    .sort((a, b) => (a.stamp === b.stamp ? b.n - a.n : a.stamp < b.stamp ? 1 : -1));
  return snaps.slice(keep).map((x) => x.name);
}

/** `name` itself, or `name` with a `-2`, `-3`… suffix before `.json` when `taken` has it (two
 *  backups in the same minute must not overwrite each other). */
export function uniqueFileName(name: string, taken: string[]): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  const stem = name.replace(/\.json$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}.json`;
    if (!set.has(candidate)) return candidate;
  }
}

export interface RestorePlan {
  restore: BackupStoreBlob[];
  skipped: { name: string; reason: string }[];
}

/** Decide which of the `selected` stores restore. `currentVersions` maps every store this app
 *  persists to the data version it reads today; `migratable` names the stores that declare a
 *  `migrate`. A store is skipped when the backup does not hold it, when this app does not know it,
 *  when it was written by a **newer** app (its version is above ours: our `migrate` cannot read the
 *  future), or when its version is **older** and the store has no `migrate` (zustand would discard
 *  the blob and hydrate nothing, wiping the store). An older version of a store with a `migrate`
 *  restores — zustand runs that `migrate` on rehydrate. Order follows `selected`. */
export function planRestore(
  bundle: BackupBundle,
  selected: string[],
  currentVersions: Record<string, number>,
  migratable: ReadonlySet<string>,
): RestorePlan {
  const byName = new Map(bundle.stores.map((s) => [s.name, s]));
  const restore: BackupStoreBlob[] = [];
  const skipped: RestorePlan['skipped'] = [];
  for (const name of selected) {
    const blob = byName.get(name);
    const current = currentVersions[name];
    if (!blob) skipped.push({ name, reason: 'Not in this backup.' });
    else if (current === undefined)
      skipped.push({ name, reason: 'This app does not know this data.' });
    else if (blob.version > current) {
      skipped.push({
        name,
        reason: `Saved by a newer app version (data version ${blob.version}; this app reads up to ${current}). Update the app to restore it.`,
      });
    } else if (blob.version < current && !migratable.has(name)) {
      skipped.push({
        name,
        reason: `Saved with an older data version (${blob.version}) that this app cannot upgrade (it reads ${current}).`,
      });
    } else restore.push(blob);
  }
  return { restore, skipped };
}

/** How many items a store blob holds, for the restore summary: the length of its first array, or
 *  the entries of its first record when it has no array (e.g. the dashboard layout per profile);
 *  null for a settings-like blob with neither. */
export function countItems(state: unknown): number | null {
  if (!isRecord(state)) return null;
  const values = Object.values(state);
  for (const v of values) if (Array.isArray(v)) return v.length;
  for (const v of values) if (isRecord(v)) return Object.keys(v).length;
  return null;
}

/** "1.2 MB" / "340 kB" / "12 B" — metric (SI) units. */
export function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} kB`;
  return `${n} B`;
}
