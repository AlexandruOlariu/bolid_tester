/** Security-access plugin files (plan 23): pick a `bolid.seedkey.v1` file (expo-document-picker),
 *  validate + compile it (`parseSeedKeyFile`), copy it to `documentDirectory/seedkeys/<id>.json`
 *  and index it in `bolid.seedKeys`; read a stored file back (re-validated and re-compiled every
 *  time — the index never holds the program); delete one. The native modules load with variable
 *  specifiers and are handed to every function, so tests run with in-memory fakes and a build
 *  without the picker degrades to "not available". Nothing here is ever sent anywhere. */
import { logError } from '@/shared/state/errorLogStore';
import { useSeedKeyStore, type SeedKeyIndexEntry } from '@/shared/state/seedKeyStore';
import {
  MAX_SEED_KEY_BYTES,
  MAX_SEED_KEY_PLUGINS,
  parseSeedKeyFile,
  type SeedKeyParse,
} from '@/shared/lib/exchange/seedKey';
import { compileSeedKey, type CompiledSeedKey, type SeedKeyPluginV1 } from '@/shared/obd-core';

export const SEED_KEYS_SOURCE = 'settings/seed-keys';

export interface SeedKeyFileSystem {
  documentDirectory?: string | null;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; size?: number }>;
  readAsStringAsync: (uri: string) => Promise<string>;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
  deleteAsync?: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
  makeDirectoryAsync?: (uri: string, opts?: { intermediates?: boolean }) => Promise<void>;
}
export interface SeedKeyPicker {
  getDocumentAsync: (opts: {
    type?: string | string[];
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }) => Promise<{
    canceled: boolean;
    assets?: { uri: string; name?: string; size?: number }[] | null;
  }>;
}
export interface SeedKeyModules {
  FileSystem: SeedKeyFileSystem;
  /** null when expo-document-picker is not in this build: import is unavailable. */
  Picker: SeedKeyPicker | null;
}

/** Load expo-file-system (legacy) and expo-document-picker. Null (logged) without a file system. */
export async function loadSeedKeyModules(): Promise<SeedKeyModules | null> {
  let FileSystem: SeedKeyFileSystem;
  try {
    FileSystem = (await import('expo-file-system/legacy' as string)) as SeedKeyFileSystem;
  } catch (e) {
    logError({ source: SEED_KEYS_SOURCE, error: e, severity: 'warning' });
    return null;
  }
  let Picker: SeedKeyPicker | null = null;
  try {
    const mod = (await import('expo-document-picker' as string)) as Partial<SeedKeyPicker>;
    if (typeof mod.getDocumentAsync === 'function') Picker = mod as SeedKeyPicker;
  } catch {
    Picker = null;
  }
  return { FileSystem, Picker };
}

export type PickedSeedKey =
  | { status: 'unavailable' }
  | { status: 'cancelled' }
  | { status: 'picked'; name: string; result: SeedKeyParse };

const PICK_TYPES = ['application/json', 'text/plain', 'application/octet-stream'];
const tooLarge = (): SeedKeyParse => ({
  ok: false,
  error: 'This file is too large for a security-access plugin.',
  details: [],
});

/** Open the OS file picker and validate the chosen file (size-checked before it is read). */
export async function pickSeedKeyFile(mods: SeedKeyModules): Promise<PickedSeedKey> {
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
    if (typeof asset.size === 'number' && asset.size > MAX_SEED_KEY_BYTES) {
      return { status: 'picked', name, result: tooLarge() };
    }
    const info = await mods.FileSystem.getInfoAsync(asset.uri);
    if (typeof info.size === 'number' && info.size > MAX_SEED_KEY_BYTES) {
      return { status: 'picked', name, result: tooLarge() };
    }
    const text = await mods.FileSystem.readAsStringAsync(asset.uri);
    return { status: 'picked', name, result: parseSeedKeyFile(text) };
  } catch (e) {
    logError({ source: SEED_KEYS_SOURCE, error: e, severity: 'warning' });
    return {
      status: 'picked',
      name,
      result: { ok: false, error: 'The file could not be opened.', details: [] },
    };
  }
}

/** `my-golf-bcm-level-03-lx2k9a` — a file-safe id from the name plus the import time. */
export function seedKeyPluginId(name: string, now: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'plugin'}-${now.toString(36)}`;
}

export function seedKeyDir(fs: SeedKeyFileSystem): string | null {
  return fs.documentDirectory ? `${fs.documentDirectory}seedkeys/` : null;
}

export type InstallOutcome = { ok: true; entry: SeedKeyIndexEntry } | { ok: false; error: string };

/** Copy a validated plugin into the app's own folder and index it. `vehicleKey` pins it to one
 *  car. The stored file is the validator's rebuilt value (unknown fields already dropped). */
export async function installSeedKeyPlugin(
  mods: SeedKeyModules,
  plugin: SeedKeyPluginV1,
  opts: { vehicleKey?: string; now?: number } = {},
): Promise<InstallOutcome> {
  const store = useSeedKeyStore.getState();
  if (store.plugins.length >= MAX_SEED_KEY_PLUGINS) {
    return { ok: false, error: `At most ${MAX_SEED_KEY_PLUGINS} plugins can be installed.` };
  }
  const dir = seedKeyDir(mods.FileSystem);
  if (!dir) return { ok: false, error: 'This device has no app storage for plugin files.' };
  const now = opts.now ?? Date.now();
  const id = seedKeyPluginId(plugin.name, now);
  const fileUri = `${dir}${id}.json`;
  try {
    await mods.FileSystem.makeDirectoryAsync?.(dir, { intermediates: true }).catch(() => undefined);
    await mods.FileSystem.writeAsStringAsync(fileUri, JSON.stringify(plugin, null, 2));
  } catch (e) {
    logError({ source: SEED_KEYS_SOURCE, error: e, severity: 'warning' });
    return { ok: false, error: 'The plugin file could not be saved on this phone.' };
  }
  const entry: SeedKeyIndexEntry = {
    id,
    name: plugin.name,
    applies: { ...plugin.applies },
    seedBytes: plugin.seedBytes,
    keyBytes: plugin.keyBytes,
    fileUri,
    importedAt: now,
    ...(opts.vehicleKey ? { vehicleKey: opts.vehicleKey } : {}),
  };
  if (!store.add(entry)) return { ok: false, error: 'A plugin with this id is already installed.' };
  return { ok: true, entry };
}

/** Delete a plugin: its file (best effort) and its index entry. */
export async function removeSeedKeyPlugin(mods: SeedKeyModules | null, id: string): Promise<void> {
  const entry = useSeedKeyStore.getState().plugins.find((p) => p.id === id);
  useSeedKeyStore.getState().remove(id);
  if (!entry || !mods?.FileSystem.deleteAsync) return;
  try {
    await mods.FileSystem.deleteAsync(entry.fileUri, { idempotent: true });
  } catch (e) {
    logError({ source: SEED_KEYS_SOURCE, error: e, severity: 'warning' });
  }
}

export type LoadedSeedKey =
  | { ok: true; plugin: SeedKeyPluginV1; seedToKey: CompiledSeedKey }
  | { ok: false; problem: string };

const sameScope = (a: SeedKeyIndexEntry, p: SeedKeyPluginV1) =>
  a.seedBytes === p.seedBytes &&
  a.keyBytes === p.keyBytes &&
  a.applies.level === p.applies.level &&
  a.applies.reqHeader === p.applies.reqHeader &&
  a.applies.address === p.applies.address &&
  a.applies.partNumberPrefix === p.applies.partNumberPrefix;

/** Read an installed plugin's file, validate it again and compile it. Any failure — the file is
 *  gone, edited into something invalid, or no longer matches the scope it was indexed with —
 *  comes back as a problem (and is logged), never as a routine. */
export async function readSeedKeyProgram(
  fs: SeedKeyFileSystem,
  entry: SeedKeyIndexEntry,
): Promise<LoadedSeedKey> {
  let text: string;
  try {
    const info = await fs.getInfoAsync(entry.fileUri);
    if (!info.exists) {
      return { ok: false, problem: `The file for “${entry.name}” is missing — import it again.` };
    }
    text = await fs.readAsStringAsync(entry.fileUri);
  } catch (e) {
    logError({
      source: SEED_KEYS_SOURCE,
      error: e,
      severity: 'warning',
      context: { id: entry.id },
    });
    return { ok: false, problem: `The file for “${entry.name}” could not be read.` };
  }
  const parsed = parseSeedKeyFile(text);
  if (!parsed.ok) {
    logError({
      source: SEED_KEYS_SOURCE,
      error: parsed.error,
      severity: 'warning',
      context: { id: entry.id, details: parsed.details.slice(0, 3).join('; ') },
    });
    return {
      ok: false,
      problem: `The file for “${entry.name}” is no longer valid — import it again.`,
    };
  }
  if (!sameScope(entry, parsed.plugin)) {
    return {
      ok: false,
      problem: `The file for “${entry.name}” changed since it was imported — import it again.`,
    };
  }
  return { ok: true, plugin: parsed.plugin, seedToKey: compileSeedKey(parsed.plugin) };
}
