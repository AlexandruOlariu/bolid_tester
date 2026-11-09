/** Profile and label-pack import / export (plan 13): the I/O and store side of the pure exchange
 *  library (`shared/lib/exchange`). Pick a file (expo-document-picker) → read it (size-checked)
 *  → `parseExchangeFile` → `previewImport` (what lands where, against the garage and the label-pack
 *  store) → `applyImport` with the user's choice (Import / Replace / Keep both). Export builds the
 *  envelope and shares it (expo-file-system legacy + expo-sharing).
 *
 *  The native modules load with variable specifiers (`loadExchangeModules`) and are handed to every
 *  I/O function, so tests run with in-memory fakes and a build without the picker degrades to "not
 *  available". Imported text is only `JSON.parse`d and rebuilt by the validator — never evaluated.
 *  See docs/exchange-formats.md. */
import { logError } from './errorLogStore';
import { useGarageStore } from './garageStore';
import { useLabelPackStore } from './labelPackStore';
import { APP_VERSION } from '@/shared/lib/appInfo';
import { validate } from '@/shared/lib/validate';
import { LABEL_PACKS } from '@/shared/labels/registry';
import { VEHICLE_REGISTRY, getVehicleProfile } from '@/shared/vehicles';
import { buildUserProfile, type UserVehicle } from '@/shared/vehicles/userVehicle';
import type { VehicleProfile } from '@/shared/vehicles/types';
import {
  MAX_EXCHANGE_BYTES,
  MAX_USER_LABEL_PACKS,
  exchangeFileName,
  exportLabelPack,
  exportProfileSeed,
  exportVehicle,
  isParseError,
  keepBothName,
  keepBothPackId,
  labelPackFileV1,
  packsForPartNumbers,
  parseExchangeFile,
  planEmbeddedPacks,
  planLabelPackImport,
  planProfileImport,
  profileFileV1,
  profilePartNumbers,
  serializeExchange,
  vehicleFromProfile,
  type ExchangeParseError,
  type LabelPackFileV1,
  type LabelPackImportPlan,
  type LabelPackV1,
  type ParsedExchange,
  type ProfileFileV1,
  type ProfileImportPlan,
} from '@/shared/lib/exchange';
import type { LabelPack } from '@/shared/labels/types';

// --- native modules ------------------------------------------------------------------------------

export interface ExchangeFileSystem {
  documentDirectory?: string | null;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; size?: number }>;
  readAsStringAsync: (uri: string) => Promise<string>;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
}
export interface ExchangeSharing {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void>;
}
export interface ExchangePicker {
  getDocumentAsync: (opts: {
    type?: string | string[];
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }) => Promise<{
    canceled: boolean;
    assets?: { uri: string; name?: string; size?: number }[] | null;
  }>;
}
export interface ExchangeModules {
  FileSystem: ExchangeFileSystem;
  /** null when sharing is not in this build: the file is still written. */
  Sharing: ExchangeSharing | null;
  /** null when expo-document-picker is not in this build: import is unavailable. */
  Picker: ExchangePicker | null;
}

/** Picked files Android may label as something other than JSON; the content is validated anyway. */
const PICK_TYPES = ['application/json', 'text/plain', 'application/octet-stream'];

/** Load expo-file-system (legacy), expo-sharing and expo-document-picker. Null (logged under
 *  `source`) when the file system itself is missing. */
export async function loadExchangeModules(source: string): Promise<ExchangeModules | null> {
  let FileSystem: ExchangeFileSystem;
  try {
    FileSystem = (await import('expo-file-system/legacy' as string)) as ExchangeFileSystem;
  } catch (e) {
    logError({ source, error: e, severity: 'warning' });
    return null;
  }
  let Sharing: ExchangeSharing | null = null;
  try {
    const mod = (await import('expo-sharing' as string)) as Partial<ExchangeSharing>;
    if (typeof mod.shareAsync === 'function') Sharing = mod as ExchangeSharing;
  } catch {
    Sharing = null;
  }
  let Picker: ExchangePicker | null = null;
  try {
    const mod = (await import('expo-document-picker' as string)) as Partial<ExchangePicker>;
    if (typeof mod.getDocumentAsync === 'function') Picker = mod as ExchangePicker;
  } catch {
    Picker = null; // not in this build (native rebuild needed): export still works
  }
  return { FileSystem, Sharing, Picker };
}

// --- pick + parse --------------------------------------------------------------------------------

export type PickedExchange =
  | { status: 'unavailable' }
  | { status: 'cancelled' }
  | { status: 'picked'; name: string; result: ParsedExchange | ExchangeParseError };

const tooLarge = (): ExchangeParseError => ({
  error: 'This file is too large (the limit is 1 MB).',
  details: [],
});

/** Open the OS file picker and parse the chosen file. A file over 1 MB is refused before it is
 *  read. Failures are logged under `source` and come back as a parse error the sheet shows. */
export async function pickExchangeFile(
  mods: ExchangeModules,
  source: string,
): Promise<PickedExchange> {
  if (!mods.Picker) return { status: 'unavailable' };
  let name = '';
  try {
    const res = await mods.Picker.getDocumentAsync({
      type: PICK_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset) return { status: 'cancelled' };
    name = asset.name ?? asset.uri.slice(asset.uri.lastIndexOf('/') + 1);
    if (typeof asset.size === 'number' && asset.size > MAX_EXCHANGE_BYTES) {
      return { status: 'picked', name, result: tooLarge() };
    }
    const info = await mods.FileSystem.getInfoAsync(asset.uri);
    if (typeof info.size === 'number' && info.size > MAX_EXCHANGE_BYTES) {
      return { status: 'picked', name, result: tooLarge() };
    }
    const text = await mods.FileSystem.readAsStringAsync(asset.uri);
    return { status: 'picked', name, result: parseExchangeFile(text) };
  } catch (e) {
    logError({ source, error: e, severity: 'warning' });
    return {
      status: 'picked',
      name,
      result: { error: 'The file could not be opened.', details: [] },
    };
  }
}

// --- preview -------------------------------------------------------------------------------------

export type ImportPreview =
  | {
      kind: 'profile';
      file: ProfileFileV1;
      plan: ProfileImportPlan;
      /** The base profile id is one this app ships (else the car lands on Auto / Generic). */
      baseKnown: boolean;
      baseName: string;
      packs: { add: LabelPackV1[]; kept: LabelPackV1[]; overCap: LabelPackV1[] };
    }
  | { kind: 'labelpack'; file: LabelPackFileV1; plan: LabelPackImportPlan };

const isKnownProfile = (id: string) => Object.prototype.hasOwnProperty.call(VEHICLE_REGISTRY, id);

/** What importing `parsed` would do right now, against the garage and the imported packs. */
export function previewImport(parsed: ParsedExchange): ImportPreview {
  if (parsed.kind === 'profile') {
    const vehicle = parsed.file.payload.vehicle;
    const baseKnown = isKnownProfile(vehicle.baseProfileId);
    return {
      kind: 'profile',
      file: parsed.file,
      plan: planProfileImport(parsed.file, useGarageStore.getState().vehicles),
      baseKnown,
      baseName: getVehicleProfile(baseKnown ? vehicle.baseProfileId : 'generic').name,
      packs: planEmbeddedPacks(parsed.file, useLabelPackStore.getState().packs),
    };
  }
  return {
    kind: 'labelpack',
    file: parsed.file,
    plan: planLabelPackImport(parsed.file.payload, useLabelPackStore.getState().packs, LABEL_PACKS),
  };
}

// --- apply ---------------------------------------------------------------------------------------

/** `create` = the plain Import; `replace` / `keep-both` resolve a conflict. */
export type ImportChoice = 'create' | 'replace' | 'keep-both';

export type ImportOutcome =
  | { ok: true; message: string; vehicleId?: string; packId?: string }
  | { ok: false; message: string };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function applyProfile(file: ProfileFileV1, choice: ImportChoice): ImportOutcome {
  const garage = useGarageStore.getState();
  const plan = planProfileImport(file, garage.vehicles);
  const fields = vehicleFromProfile(file.payload.vehicle, isKnownProfile);
  let vehicleId: string;
  let name = fields.name;
  if (plan.action === 'conflict' && choice === 'replace') {
    garage.replace(plan.existingId, fields);
    vehicleId = plan.existingId;
  } else if (plan.action === 'conflict' && choice === 'keep-both') {
    name = keepBothName(
      fields.name,
      garage.vehicles.map((v) => v.name),
    );
    vehicleId = garage.add({ ...fields, name }).id;
  } else if (plan.action === 'create') {
    vehicleId = garage.add(fields).id;
  } else {
    return { ok: false, message: 'Choose Replace or Keep both for a car that is already here.' };
  }
  const packs = planEmbeddedPacks(file, useLabelPackStore.getState().packs);
  const addPack = useLabelPackStore.getState().add;
  // `add` prepends, so add in reverse: the packs land in file order (the exporter's precedence
  // order, newest first), and an equal-length prefix tie resolves the same way on both phones.
  const added = [...packs.add].reverse().filter((p) => addPack(p)).length;
  const extra = added ? ` and ${plural(added, 'label pack')}` : '';
  return { ok: true, message: `Imported ${name}${extra}.`, vehicleId };
}

const FULL_MESSAGE = `You already have ${MAX_USER_LABEL_PACKS} imported label packs. Delete one in Settings → Data first.`;

function applyLabelPack(file: LabelPackFileV1, choice: ImportChoice): ImportOutcome {
  const store = useLabelPackStore.getState();
  const pack = file.payload;
  const plan = planLabelPackImport(pack, store.packs, LABEL_PACKS);
  if (plan.action === 'replace' && choice === 'replace') {
    store.replace(pack.id, pack);
    return { ok: true, message: `Replaced the ${pack.module} pack.`, packId: pack.id };
  }
  if (plan.action === 'replace' && choice !== 'keep-both') {
    return { ok: false, message: 'Choose Replace or Keep both for a pack that is already here.' };
  }
  if (plan.full) return { ok: false, message: FULL_MESSAGE };
  const id =
    plan.action === 'replace'
      ? keepBothPackId(
          pack.id,
          store.packs.map((p) => p.id),
        )
      : pack.id;
  if (!store.add({ ...pack, id })) {
    return { ok: false, message: FULL_MESSAGE };
  }
  return { ok: true, message: `Imported the ${pack.module} pack.`, packId: id };
}

/** Apply a previewed import with the user's choice. The plan is re-made against the stores as
 *  they are now, so nothing that changed since the preview is overwritten by surprise. */
export function applyImport(preview: ImportPreview, choice: ImportChoice): ImportOutcome {
  return preview.kind === 'profile'
    ? applyProfile(preview.file, choice)
    : applyLabelPack(preview.file, choice);
}

// --- export --------------------------------------------------------------------------------------

/** The profile file for garage car `user`, embedding the imported packs that match the part
 *  numbers its resolved profile knows. */
export function vehicleExportFile(user: UserVehicle, now: number = Date.now()): ProfileFileV1 {
  const profile = buildUserProfile(user, getVehicleProfile(user.baseProfileId));
  const packs = packsForPartNumbers(
    profilePartNumbers(profile),
    useLabelPackStore.getState().packs,
  );
  return exportVehicle(user, packs, { appVersion: APP_VERSION, now });
}

export function profileSeedFile(profile: VehicleProfile, now: number = Date.now()): ProfileFileV1 {
  return exportProfileSeed(profile, { appVersion: APP_VERSION, now });
}

export function labelPackExportFile(pack: LabelPack, now: number = Date.now()): LabelPackFileV1 {
  return exportLabelPack(pack, { appVersion: APP_VERSION, now });
}

/** Write `file` to the document directory as `exchangeFileName(…)` and open the share sheet.
 *  Resolves with the URI, or null when nothing was written (logged under `source`). */
export async function shareExchangeFile(
  mods: ExchangeModules,
  file: ProfileFileV1 | LabelPackFileV1,
  opts: { source: string; title: string; now?: Date },
): Promise<string | null> {
  try {
    const dir = mods.FileSystem.documentDirectory ?? '';
    if (!dir) {
      logError({
        source: opts.source,
        error: new Error('No document directory on this platform; nothing was exported.'),
        severity: 'warning',
      });
      return null;
    }
    const isProfile = file.schema === 'bolid.profile.v1';
    // Never hand out a file this (or any) importer would refuse.
    const check = isProfile ? validate(profileFileV1, file) : validate(labelPackFileV1, file);
    if (!check.ok) {
      logError({
        source: opts.source,
        error: new Error('The exported file does not match its schema; nothing was exported.'),
        severity: 'warning',
        context: { errors: check.errors.slice(0, 5).join('; ') },
      });
      return null;
    }
    const label = isProfile
      ? (file as ProfileFileV1).payload.vehicle.name
      : (file as LabelPackFileV1).payload.id;
    const uri = `${dir}${exchangeFileName(isProfile ? 'profile' : 'labelpack', label, opts.now)}`;
    await mods.FileSystem.writeAsStringAsync(uri, serializeExchange(file));
    try {
      if (mods.Sharing && (await mods.Sharing.isAvailableAsync())) {
        await mods.Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: opts.title,
        });
      }
    } catch (e) {
      logError({ source: opts.source, error: e, severity: 'warning', context: { uri } });
    }
    return uri;
  } catch (e) {
    logError({ source: opts.source, error: e, severity: 'warning' });
    return null;
  }
}

export { isParseError };
