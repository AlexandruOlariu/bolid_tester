/** Which installed security-access plugin (plan 23) unlocks a module, and what every write surface
 *  does with the answer. Pure matching (`matchSeedKeyPlugin`, `unlockStatusFor`, `decideSecurity`)
 *  plus the async resolution that reads and compiles the plugin file (`resolveSeedKey`).
 *
 *  Matching order, among plugins for the requested SecurityAccess `level` and — when a plugin is
 *  pinned — for this car only: (1) the plugin names the module's request header (or VAG address);
 *  (2) the plugin names only a part-number prefix and the module's known part number starts with
 *  it. A pinned plugin beats an unpinned one, then the newest import wins. A plugin that names a
 *  prefix never matches a module whose part number is unknown or different — fail closed: a wrong
 *  key burns one of the module's few attempts. See docs/features/coding.md. */
import { historyVehicleKey } from '@/shared/state/historyStore';
import { useSeedKeyStore, type SeedKeyIndexEntry } from '@/shared/state/seedKeyStore';
import type { CompiledSeedKey } from '@/shared/obd-core';
import { NO_PLUGIN_MESSAGE } from './messages';
import { loadSeedKeyModules, readSeedKeyProgram, type SeedKeyFileSystem } from './seedKeyFiles';

export interface SeedKeyTarget {
  /** ATSH request header of the module (e.g. '70E'). */
  reqHeader: string;
  /** SecurityAccess requestSeed level the module declares. */
  level: number;
  /** VAG address ('09'), when the surface knows it. */
  address?: string;
  /** Module part number (F187), when known. */
  partNumber?: string;
  /** The active car's keys (`seedKeyVehicleKeys`) — a pinned plugin matches only these. */
  vehicleKeys?: string[];
}

export interface UnlockStatus {
  state: 'none-required' | 'unlockable' | 'locked';
  pluginName?: string;
  level?: number;
}

export { NO_PLUGIN_MESSAGE };

/** A car's plugin keys, primary first: the VIN key once the car reported a VIN, then the
 *  profile-id key (the same keys the code book uses). */
export function seedKeyVehicleKeys(profileId: string, vin: string | null | undefined): string[] {
  const idKey = historyVehicleKey({ id: profileId, label: '', vin: null });
  return vin ? [historyVehicleKey({ id: profileId, label: '', vin }), idKey] : [idKey];
}

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** The installed plugin for `target`, or null. Pure. */
export function matchSeedKeyPlugin(
  entries: SeedKeyIndexEntry[],
  target: SeedKeyTarget,
): SeedKeyIndexEntry | null {
  const keys = target.vehicleKeys ?? [];
  const part = target.partNumber ? norm(target.partNumber) : null;
  const eligible = entries.filter((e) => {
    if (e.applies.level !== target.level) return false;
    if (e.vehicleKey && !keys.includes(e.vehicleKey)) return false;
    const prefix = e.applies.partNumberPrefix;
    if (prefix && !(part && part.startsWith(norm(prefix)))) return false;
    return true;
  });
  const best = (list: SeedKeyIndexEntry[]) => list.find((e) => e.vehicleKey) ?? list[0] ?? null;

  const byModule = eligible.filter(
    (e) =>
      (e.applies.reqHeader !== undefined && norm(e.applies.reqHeader) === norm(target.reqHeader)) ||
      (e.applies.address !== undefined &&
        target.address !== undefined &&
        norm(e.applies.address) === norm(target.address)),
  );
  const exact = best(byModule);
  if (exact) return exact;
  // Prefix-only plugins (no header / address named). The prefix was checked above.
  return best(
    eligible.filter(
      (e) => e.applies.partNumberPrefix && !e.applies.reqHeader && !e.applies.address,
    ),
  );
}

/** Badge state for a write surface: no `security` → no unlock needed; a plugin → unlockable;
 *  otherwise locked. Pure. */
export function unlockStatusFor(
  security: { level: number } | undefined,
  plugin: { name: string } | null,
): UnlockStatus {
  if (!security) return { state: 'none-required' };
  if (plugin) return { state: 'unlockable', pluginName: plugin.name, level: security.level };
  return { state: 'locked', level: security.level };
}

export interface ResolvedSeedKey {
  /** The matched plugin (null when none is installed for the module). */
  entry: SeedKeyIndexEntry | null;
  /** The compiled routine, null when nothing matched or the file could not be used. */
  seedToKey: CompiledSeedKey | null;
  /** Why a matched plugin could not be used (missing / edited file). */
  problem?: string;
}

export interface ResolveDeps {
  entries?: SeedKeyIndexEntry[];
  fs?: SeedKeyFileSystem | null;
}

/** Find the plugin for `target` and load its routine (the file is read, re-validated and
 *  compiled now — never cached across unlocks). */
export async function resolveSeedKey(
  target: SeedKeyTarget,
  deps: ResolveDeps = {},
): Promise<ResolvedSeedKey> {
  const entries = deps.entries ?? useSeedKeyStore.getState().plugins;
  const entry = matchSeedKeyPlugin(entries, target);
  if (!entry) return { entry: null, seedToKey: null };
  const fs = deps.fs !== undefined ? deps.fs : ((await loadSeedKeyModules())?.FileSystem ?? null);
  if (!fs)
    return { entry, seedToKey: null, problem: 'Plugin files cannot be read on this device.' };
  const loaded = await readSeedKeyProgram(fs, entry);
  return loaded.ok
    ? { entry, seedToKey: loaded.seedToKey }
    : { entry, seedToKey: null, problem: loaded.problem };
}

/** `resolveSeedKey`, reduced to the routine (null = nothing can unlock the module). */
export async function resolveSeedToKey(
  target: SeedKeyTarget,
  deps: ResolveDeps = {},
): Promise<CompiledSeedKey | null> {
  return (await resolveSeedKey(target, deps)).seedToKey;
}

export type SecurityDecision =
  | { kind: 'none' }
  | { kind: 'unlock'; security: { level: number; seedToKey: (seed: number[]) => number[] } }
  | { kind: 'refuse'; message: string };

/** What a write does about SecurityAccess: nothing (the module needs none), unlock with the
 *  resolved routine, or refuse **before any bus traffic** — never a made-up key. Pure. */
export function decideSecurity(
  security: { level: number } | undefined,
  resolved: {
    seedToKey: ((seed: number[]) => number[]) | null;
    entry?: SeedKeyIndexEntry | null;
    problem?: string;
  } | null,
): SecurityDecision {
  if (!security) return { kind: 'none' };
  if (resolved?.seedToKey) {
    return { kind: 'unlock', security: { level: security.level, seedToKey: resolved.seedToKey } };
  }
  if (resolved?.entry && resolved.problem) {
    return { kind: 'refuse', message: `Locked. ${resolved.problem} Nothing was sent.` };
  }
  return { kind: 'refuse', message: NO_PLUGIN_MESSAGE };
}
