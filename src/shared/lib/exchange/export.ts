/** Export side of the exchange files (plan 13), pure: a garage car, a built-in profile (as a
 *  **seed**) or a label pack as a versioned envelope, plus the file name. Only data fields are
 *  copied — never `decode` functions, never the code book. See docs/exchange-formats.md. */
import type { LabelPack } from '../../labels/types';
import type { VehicleProfile } from '../../vehicles/types';
import {
  VEHICLE_NAME_MAX,
  VEHICLE_NOTES_MAX,
  defaultVehicleName,
  sanitizeUserModules,
  type UserVehicle,
} from '../../vehicles/userVehicle';
import { MAX_IDENT_CHARS } from './schemas';
import {
  EXCHANGE_APP_NAME,
  LABELPACK_SCHEMA_V1,
  PROFILE_SCHEMA_V1,
  type ExchangeVehicleV1,
  type LabelPackFileV1,
  type LabelPackV1,
  type ProfileFileV1,
} from './types';

export interface ExportMeta {
  appVersion: string;
  now?: number;
}

function app(meta: ExportMeta): ProfileFileV1['app'] {
  return { name: EXCHANGE_APP_NAME, version: meta.appVersion };
}

/** A deep, data-only copy of a pack: the known fields, in a fixed order. */
export function cleanLabelPack(pack: LabelPack | LabelPackV1): LabelPackV1 {
  const p = pack as LabelPackV1;
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  return {
    id: p.id,
    module: p.module,
    partNumberPrefixes: [...p.partNumberPrefixes],
    ...(p.measurements ? { measurements: copy(p.measurements) } : {}),
    ...(p.codingBits ? { codingBits: copy(p.codingBits) } : {}),
    ...(p.adaptations ? { adaptations: copy(p.adaptations) } : {}),
    ...(p.measuringGroups ? { measuringGroups: copy(p.measuringGroups) } : {}),
    ...(p.author !== undefined ? { author: p.author } : {}),
    ...(p.source !== undefined ? { source: p.source } : {}),
    ...(p.license !== undefined ? { license: p.license } : {}),
    ...(p.confirmed ? { confirmed: copy(p.confirmed) } : {}),
  };
}

/** The part numbers a car's profile knows for its modules: coding modules' `partNumber` and the
 *  modules' seeded `F187` idents. */
export function profilePartNumbers(profile: VehicleProfile): string[] {
  const out = new Set<string>();
  for (const m of profile.codingModules ?? []) if (m.partNumber) out.add(m.partNumber);
  for (const m of profile.modules ?? []) {
    const pn = m.sampleIdent?.F187;
    if (pn) out.add(pn);
  }
  return [...out].map((p) => p.replace(/\s+/g, '').toUpperCase());
}

/** The user's packs that apply to any of `partNumbers` (prefix match), for embedding. */
export function packsForPartNumbers(
  partNumbers: string[],
  userPacks: LabelPackV1[],
): LabelPackV1[] {
  return userPacks.filter((pack) =>
    pack.partNumberPrefixes.some((prefix) => {
      const p = prefix.replace(/\s+/g, '').toUpperCase();
      return partNumbers.some((pn) => pn.startsWith(p));
    }),
  );
}

/** `s` cut to at most `max` UTF-16 units, never splitting a surrogate pair. */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A learned ident string (calibration id, adapter version) as the schema takes it: printable
 *  ASCII, single-spaced, at most `MAX_IDENT_CHARS`. Empty → null. An ECU reporting several CALIDs
 *  can join to more than that; the first `MAX_IDENT_CHARS` characters are kept. */
function cleanIdent(s: string | null | undefined): string | null {
  if (!s) return null;
  const printable = s
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clipText(printable, MAX_IDENT_CHARS).trim() || null;
}

/** A garage car as a `bolid.profile.v1` file. `packs` are embedded (the user's imported packs for
 *  this car's modules). The code book (`loginCodes`) is left out. Name, notes and the learned
 *  ident strings are clamped to the schema's limits, so every garage car exports to a file that
 *  imports again (a car saved before the editor capped its fields, or a long joined CALID, would
 *  otherwise not). */
export function exportVehicle(
  user: UserVehicle,
  packs: LabelPackV1[],
  meta: ExportMeta,
): ProfileFileV1 {
  const modules = sanitizeUserModules(user.modules);
  const name =
    clipText(user.name.trim(), VEHICLE_NAME_MAX).trim() ||
    defaultVehicleName(user.learned?.vin ?? null);
  const adapterVersion = cleanIdent(user.learned?.adapterVersion);
  const vehicle: ExchangeVehicleV1 = {
    name,
    ...(user.year !== undefined ? { year: user.year } : {}),
    fuel: user.fuel,
    ...(user.make !== undefined ? { make: user.make } : {}),
    baseProfileId: user.baseProfileId,
    ...(user.learned
      ? {
          learned: {
            protocol: user.learned.protocol,
            supportedPids: [...user.learned.supportedPids],
            vin: user.learned.vin,
            calibrationId: cleanIdent(user.learned.calibrationId),
            ...(adapterVersion !== null ? { adapterVersion } : {}),
            learnedAt: user.learned.learnedAt,
          },
        }
      : {}),
    ...(user.notes !== undefined ? { notes: clipText(user.notes, VEHICLE_NOTES_MAX) } : {}),
    ...(modules ? { modules } : {}),
    sourceId: user.id,
  };
  return {
    schema: PROFILE_SCHEMA_V1,
    exportedAt: new Date(meta.now ?? Date.now()).toISOString(),
    app: app(meta),
    payload: {
      vehicle,
      ...(packs.length ? { labelPacks: packs.map(cleanLabelPack) } : {}),
    },
  };
}

/** A built-in profile as a **seed**: a car with the profile's name, year, fuel and make that
 *  inherits from that profile and has learned nothing yet (the receiver learns their own car on
 *  connect). */
export function exportProfileSeed(profile: VehicleProfile, meta: ExportMeta): ProfileFileV1 {
  return {
    schema: PROFILE_SCHEMA_V1,
    exportedAt: new Date(meta.now ?? Date.now()).toISOString(),
    app: app(meta),
    payload: {
      vehicle: {
        name: profile.name,
        ...(profile.year > 0 ? { year: profile.year } : {}), // generic's placeholder year is 0
        fuel: profile.fuel,
        ...(profile.make ? { make: profile.make } : {}),
        baseProfileId: profile.id,
        sourceId: profile.id,
      },
    },
  };
}

/** A label pack (bundled or imported) as a `bolid.labelpack.v1` file. */
export function exportLabelPack(pack: LabelPack | LabelPackV1, meta: ExportMeta): LabelPackFileV1 {
  return {
    schema: LABELPACK_SCHEMA_V1,
    exportedAt: new Date(meta.now ?? Date.now()).toISOString(),
    app: app(meta),
    payload: cleanLabelPack(pack),
  };
}

/** Lowercase ASCII slug for a file name: "VW Golf Plus 2009" → "vw-golf-plus-2009". */
export function slug(s: string): string {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return out || 'file';
}

/** `bolid-profile-<slug>-<stamp>.json` / `bolid-labelpack-<slug>-<stamp>.json`. */
export function exchangeFileName(
  kind: 'profile' | 'labelpack',
  label: string,
  now: Date = new Date(),
): string {
  return `bolid-${kind}-${slug(label)}-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

export function serializeExchange(file: ProfileFileV1 | LabelPackFileV1): string {
  return JSON.stringify(file, null, 2);
}

/** What a pack names, for the preview and the Settings list. */
export function labelPackCounts(pack: LabelPack): {
  measurements: number;
  codingBits: number;
  adaptations: number;
  measuringGroups: number;
} {
  return {
    measurements: Object.keys(pack.measurements ?? {}).length,
    codingBits: Object.values(pack.codingBits ?? {}).reduce((n, l) => n + l.length, 0),
    adaptations: Object.keys(pack.adaptations ?? {}).length,
    measuringGroups: Object.keys(pack.measuringGroups ?? {}).length,
  };
}
