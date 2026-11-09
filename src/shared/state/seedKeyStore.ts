/** Installed security-access plugins (plan 23): the **index** of the `bolid.seedkey.v1` files the
 *  owner imported — name, scope, widths, where the file lives and, optionally, the one car it is
 *  pinned to (`vehicleKey`, a `historyVehicleKey`). The program itself is **not** here: it stays in
 *  `documentDirectory/seedkeys/<id>.json` and is read, re-validated and compiled each time an
 *  unlock needs it (`shared/security/resolveSeedKey.ts`).
 *
 *  Persisted as `bolid.seedKeys` (v1). Deliberately **not** part of a backup (plan 18's registry
 *  lists it under `NOT_BACKED_UP`) and never in `bolid.settings` or an exchange file: a plugin
 *  belongs to the phone and the car it was imported for; on a new phone the owner imports the file
 *  again. A persisted blob is re-validated entry by entry on load (`sanitizeSeedKeyIndex`). See
 *  docs/features/coding.md → Security-access plugins. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';
import { v, validate, type Validator } from '@/shared/lib/validate';
import { MAX_SEED_KEY_PLUGINS } from '@/shared/lib/exchange/seedKey';
import type { SeedKeyPluginV1 } from '@/shared/obd-core';

export const SEED_KEYS_VERSION = 1;

export interface SeedKeyIndexEntry {
  id: string;
  name: string;
  applies: SeedKeyPluginV1['applies'];
  seedBytes: 2 | 4;
  keyBytes: 2 | 4;
  /** `documentDirectory/seedkeys/<id>.json`. */
  fileUri: string;
  importedAt: number;
  /** Pinned to one car (`historyVehicleKey`: `vin:…` or `id:…`); absent = any car. */
  vehicleKey?: string;
}

interface SeedKeyState {
  plugins: SeedKeyIndexEntry[];
  /** Add in front. False when the id exists or the phone already holds the maximum. */
  add: (entry: SeedKeyIndexEntry) => boolean;
  remove: (id: string) => void;
}

const width = ((x, path) =>
  x === 2 || x === 4
    ? { ok: true, value: x }
    : { ok: false, errors: [`${path}: must be 2 or 4`] }) as Validator<2 | 4>;

const indexEntry = v.obj<SeedKeyIndexEntry>({
  id: v.str({ pattern: /^[a-z0-9][a-z0-9-]{0,63}$/ }),
  name: v.str({ min: 1, max: 80 }),
  applies: v.obj<SeedKeyIndexEntry['applies']>({
    reqHeader: v.opt(v.str({ pattern: /^[0-9A-F]{3}(?:[0-9A-F]{5})?$/ })),
    address: v.opt(v.hex(2)),
    level: v.num({ int: true, min: 1, max: 0x7d }),
    partNumberPrefix: v.opt(v.str({ pattern: /^[0-9A-Z]{3,12}$/ })),
  }),
  seedBytes: width,
  keyBytes: width,
  fileUri: v.str({ min: 1, max: 1000 }),
  importedAt: v.num({ int: true, min: 0 }),
  vehicleKey: v.opt(v.str({ min: 1, max: 120 })),
});

/** Keep only entries that pass the index schema, first of each id, at most the cap. */
export function sanitizeSeedKeyIndex(persisted: unknown): SeedKeyIndexEntry[] {
  const list = (persisted as { plugins?: unknown } | null)?.plugins;
  if (!Array.isArray(list)) return [];
  const out: SeedKeyIndexEntry[] = [];
  const ids = new Set<string>();
  for (const raw of list) {
    const r = validate(indexEntry, raw);
    if (!r.ok || ids.has(r.value.id)) continue;
    ids.add(r.value.id);
    out.push(r.value);
    if (out.length >= MAX_SEED_KEY_PLUGINS) break;
  }
  return out;
}

export const useSeedKeyStore = create<SeedKeyState>()(
  persist(
    (set, get) => ({
      plugins: [],
      add: (entry) => {
        const { plugins } = get();
        if (plugins.length >= MAX_SEED_KEY_PLUGINS || plugins.some((p) => p.id === entry.id)) {
          return false;
        }
        set({ plugins: [entry, ...plugins] });
        return true;
      },
      remove: (id) => set((s) => ({ plugins: s.plugins.filter((p) => p.id !== id) })),
    }),
    {
      name: 'bolid.seedKeys',
      version: SEED_KEYS_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ plugins: s.plugins }),
      merge: (persisted, current) => {
        const stored = sanitizeSeedKeyIndex(persisted);
        const ids = new Set(stored.map((p) => p.id));
        const addedMeanwhile = current.plugins.filter((p) => !ids.has(p.id));
        return {
          ...current,
          plugins: [...addedMeanwhile, ...stored].slice(0, MAX_SEED_KEY_PLUGINS),
        };
      },
    },
  ),
);
