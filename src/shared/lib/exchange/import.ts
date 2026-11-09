/** Import side of the exchange files (plan 13), pure: parse + validate an untrusted file, then plan
 *  how it lands next to what is already on the phone (create, replace, keep both). The text is only
 *  ever `JSON.parse`d — nothing in it is evaluated — and the parsed value is rebuilt by the
 *  validator, so the app stores only fields the schema names. See docs/exchange-formats.md. */
import { validate } from '../validate';
import { utf8Bytes } from '../backup';
import type { LabelPack } from '../../labels/types';
import { VEHICLE_NAME_MAX, type UserVehicle } from '../../vehicles/userVehicle';
import { clipText } from './export';
import { labelPackFileV1, profileFileV1 } from './schemas';
import {
  LABELPACK_SCHEMA_V1,
  PROFILE_SCHEMA_V1,
  type ExchangeVehicleV1,
  type LabelPackFileV1,
  type LabelPackV1,
  type ProfileFileV1,
} from './types';

/** Largest file the app reads (1 MB). */
export const MAX_EXCHANGE_BYTES = 1_000_000;
/** Imported label packs kept on the phone. */
export const MAX_USER_LABEL_PACKS = 100;

export type ParsedExchange =
  | { kind: 'profile'; file: ProfileFileV1 }
  | { kind: 'labelpack'; file: LabelPackFileV1 };

/** A rejected file: a one-line reason plus the validator's errors (the UI shows the first three). */
export interface ExchangeParseError {
  error: string;
  details: string[];
}

export const isParseError = (r: ParsedExchange | ExchangeParseError): r is ExchangeParseError =>
  'error' in r;

const SCHEMA_RE = /^bolid\.(profile|labelpack)\.v(\d+)$/;

/** JSON parse → read `schema` → validate with the matching schema; 1 MB limit. */
export function parseExchangeFile(text: string): ParsedExchange | ExchangeParseError {
  if (text.length > MAX_EXCHANGE_BYTES || utf8Bytes(text) > MAX_EXCHANGE_BYTES) {
    return { error: 'This file is too large (the limit is 1 MB).', details: [] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { error: 'This file is not valid JSON.', details: [] };
  }
  const schema =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as { schema?: unknown }).schema
      : undefined;
  if (typeof schema === 'string' && schema.startsWith('bolid.seedkey.')) {
    return {
      error:
        'This is a security-access plugin. Import it under Settings → Data → Security access plugins.',
      details: [],
    };
  }
  if (typeof schema !== 'string') {
    const kind = (data as { kind?: unknown } | null)?.kind;
    if (kind === 'bolid.garage') {
      return {
        error:
          'This is a whole-garage export. Import one car at a time: share it with Export on its garage card.',
        details: [],
      };
    }
    return { error: 'This is not a bolid-tester profile or label-pack file.', details: [] };
  }
  if (schema === PROFILE_SCHEMA_V1 || schema === LABELPACK_SCHEMA_V1) {
    const r =
      schema === PROFILE_SCHEMA_V1
        ? validate(profileFileV1, data)
        : validate(labelPackFileV1, data);
    if (!r.ok) {
      return {
        error: `This ${schema === PROFILE_SCHEMA_V1 ? 'profile' : 'label-pack'} file is not valid.`,
        details: r.errors,
      };
    }
    return schema === PROFILE_SCHEMA_V1
      ? { kind: 'profile', file: r.value as ProfileFileV1 }
      : { kind: 'labelpack', file: r.value as LabelPackFileV1 };
  }
  const m = SCHEMA_RE.exec(schema);
  if (m && Number(m[2]) > 1) {
    return {
      error: `This file uses format ${schema}, made by a newer version of the app. Update the app to import it.`,
      details: [],
    };
  }
  return {
    error: `Unknown file format "${schema.slice(0, 40)}". Expected ${PROFILE_SCHEMA_V1} or ${LABELPACK_SCHEMA_V1}.`,
    details: [],
  };
}

// --- profiles ------------------------------------------------------------------------------------

const normVin = (vin: string) => vin.replace(/\s+/g, '').toUpperCase();
const normName = (name: string) => name.trim().toLowerCase();

export type ProfileImportPlan =
  | { action: 'create' }
  | {
      action: 'conflict';
      existingId: string;
      existingName: string;
      reason: 'same-vin' | 'same-name';
    };

/** A garage car with the same learned VIN conflicts first; else one with the same name (case- and
 *  space-insensitive); else the car is new. */
export function planProfileImport(file: ProfileFileV1, existing: UserVehicle[]): ProfileImportPlan {
  const vehicle = file.payload.vehicle;
  const vin = vehicle.learned?.vin ? normVin(vehicle.learned.vin) : null;
  if (vin) {
    const hit = existing.find((v) => v.learned?.vin && normVin(v.learned.vin) === vin);
    if (hit) {
      return { action: 'conflict', existingId: hit.id, existingName: hit.name, reason: 'same-vin' };
    }
  }
  const hit = existing.find((v) => normName(v.name) === normName(vehicle.name));
  if (hit) {
    return { action: 'conflict', existingId: hit.id, existingName: hit.name, reason: 'same-name' };
  }
  return { action: 'create' };
}

/** `name (2)`, `name (3)`… — the first not taken (case-insensitive). The name is shortened so the
 *  result stays within `max` characters (the garage name limit, which the schema shares). */
export function keepBothName(
  name: string,
  taken: string[],
  max: number = VEHICLE_NAME_MAX,
): string {
  const used = new Set(taken.map(normName));
  const withSuffix = (suffix: string) =>
    `${clipText(name.trim(), Math.max(1, max - suffix.length)).trimEnd()}${suffix}`;
  for (let n = 2; n < 1000; n++) {
    const candidate = withSuffix(` (${n})`);
    if (!used.has(normName(candidate))) return candidate;
  }
  return withSuffix(` (${Date.now()})`);
}

/** A garage car's fields from an imported profile (no id / timestamps yet). An unknown base
 *  profile id — a profile this app version does not ship — falls back to `generic`. */
export function vehicleFromProfile(
  vehicle: ExchangeVehicleV1,
  isKnownProfile: (id: string) => boolean,
): Omit<UserVehicle, 'id' | 'createdAt' | 'updatedAt'> {
  const { sourceId: _source, ...rest } = vehicle;
  return {
    ...rest,
    baseProfileId: isKnownProfile(vehicle.baseProfileId) ? vehicle.baseProfileId : 'generic',
  };
}

// --- label packs ---------------------------------------------------------------------------------

const normPrefix = (p: string) => p.replace(/\s+/g, '').toUpperCase();

/** Another pack that matches some of the same part numbers as the imported one. */
export interface PackOverlap {
  packId: string;
  module: string;
  bundled: boolean;
  /** The imported pack's prefix. */
  prefix: string;
  /** The other pack's overlapping prefix. */
  otherPrefix: string;
  /** The imported pack's names win for the part numbers both match (its prefix is at least as
   *  long; on an equal length a user pack beats a bundled one and the newest import beats an
   *  older one). */
  importedWins: boolean;
}

export interface LabelPackImportPlan {
  /** `replace` when a user pack with the same id is already imported. */
  action: 'create' | 'replace';
  overlaps: PackOverlap[];
  /** The phone already holds the maximum number of imported packs (a replace still fits). */
  full: boolean;
}

/** How `pack` lands next to the user's packs and the bundled ones. */
export function planLabelPackImport(
  pack: LabelPackV1,
  userPacks: LabelPack[],
  bundled: LabelPack[],
  cap: number = MAX_USER_LABEL_PACKS,
): LabelPackImportPlan {
  const replace = userPacks.some((p) => p.id === pack.id);
  const others = [
    ...userPacks.filter((p) => p.id !== pack.id).map((p) => ({ p, bundled: false })),
    ...bundled.map((p) => ({ p, bundled: true })),
  ];
  const overlaps: PackOverlap[] = [];
  for (const raw of pack.partNumberPrefixes) {
    const prefix = normPrefix(raw);
    for (const { p, bundled: isBundled } of others) {
      for (const otherRaw of p.partNumberPrefixes) {
        const other = normPrefix(otherRaw);
        if (!prefix.startsWith(other) && !other.startsWith(prefix)) continue;
        overlaps.push({
          packId: p.id,
          module: p.module,
          bundled: isBundled,
          prefix,
          otherPrefix: other,
          importedWins: prefix.length >= other.length,
        });
      }
    }
  }
  return {
    action: replace ? 'replace' : 'create',
    overlaps,
    full: !replace && userPacks.length >= cap,
  };
}

/** The preview's warning for one overlap. */
export function overlapText(o: PackOverlap): string {
  const owner = `${o.bundled ? 'the bundled' : 'your imported'} ${o.module} pack`;
  const same =
    o.prefix === o.otherPrefix
      ? `prefix ${o.prefix}`
      : `part numbers starting with ${o.prefix.length > o.otherPrefix.length ? o.prefix : o.otherPrefix}`;
  return o.importedWins
    ? `This pack also matches ${same} used by ${owner}; the imported names will take precedence.`
    : `This pack also matches ${same}, but ${owner} has the longer prefix (${o.otherPrefix}), so its names stay in use there.`;
}

/** `id-2`, `id-3`… — the first id not taken (for **Keep both**). */
export function keepBothPackId(id: string, taken: string[]): string {
  const used = new Set(taken);
  const base = id.slice(0, 60);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Embedded packs of a profile file: the ones to add (no user pack has the id; within the cap),
 *  and the ones skipped because a pack with that id is already on the phone (the local one is
 *  kept) or the phone is full. */
export function planEmbeddedPacks(
  file: ProfileFileV1,
  userPacks: LabelPack[],
  cap: number = MAX_USER_LABEL_PACKS,
): { add: LabelPackV1[]; kept: LabelPackV1[]; overCap: LabelPackV1[] } {
  const ids = new Set(userPacks.map((p) => p.id));
  const add: LabelPackV1[] = [];
  const kept: LabelPackV1[] = [];
  const overCap: LabelPackV1[] = [];
  let room = Math.max(0, cap - userPacks.length);
  for (const p of file.payload.labelPacks ?? []) {
    if (ids.has(p.id)) kept.push(p);
    else if (room > 0) {
      add.push(p);
      ids.add(p.id);
      room--;
    } else overCap.push(p);
  }
  return { add, kept, overCap };
}
