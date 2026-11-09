/** Imported label packs (plan 13): packs the user brought in as `bolid.labelpack.v1` files (or
 *  embedded in a profile file), newest first, at most `MAX_USER_LABEL_PACKS`. Persisted as
 *  `bolid.labelPacks` (v1). Every change — and the hydrated list — is pushed into the label
 *  registry (`setUserLabelPacks`), so `findLabelPack` sees the packs everywhere (coding helper,
 *  adaptations, measuring groups) without any feature knowing about this store. A persisted blob
 *  is re-validated entry by entry on load (`sanitizeLabelPacks`): a hand-edited file can drop
 *  packs, never crash a lookup. See docs/features/settings.md → Data and docs/exchange-formats.md. */
import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';
import { LABEL_PACKS, findLabelPackIn, setUserLabelPacks } from '@/shared/labels/registry';
import type { LabelPack } from '@/shared/labels/types';
import { validate } from '@/shared/lib/validate';
import { labelPackV1, MAX_USER_LABEL_PACKS, type LabelPackV1 } from '@/shared/lib/exchange';

export const LABEL_PACKS_VERSION = 1;

interface LabelPackState {
  packs: LabelPackV1[];
  /** Add a new pack in front (the newest import wins an equal-prefix tie). False when a pack with
   *  that id exists (use `replace`) or the phone already holds the maximum. */
  add: (pack: LabelPackV1) => boolean;
  /** Replace the pack with id `id` by `pack` (moved to the front). False when there is none. */
  replace: (id: string, pack: LabelPackV1) => boolean;
  remove: (id: string) => void;
}

/** Keep only packs that pass the `labelPackV1` schema, first of each id, at most the cap. */
export function sanitizeLabelPacks(persisted: unknown): LabelPackV1[] {
  const list = (persisted as { packs?: unknown } | null)?.packs;
  if (!Array.isArray(list)) return [];
  const out: LabelPackV1[] = [];
  const ids = new Set<string>();
  for (const raw of list) {
    const r = validate(labelPackV1, raw);
    if (!r.ok || ids.has(r.value.id)) continue;
    ids.add(r.value.id);
    out.push(r.value);
    if (out.length >= MAX_USER_LABEL_PACKS) break;
  }
  return out;
}

/** Set by `merge` when a pack was imported during the rehydration window (same reason as the
 *  garage store: the merged list must be written back once hydration finishes). */
let rewriteAfterHydration = false;

export const useLabelPackStore = create<LabelPackState>()(
  persist(
    (set, get) => ({
      packs: [],
      add: (pack) => {
        const { packs } = get();
        if (packs.length >= MAX_USER_LABEL_PACKS || packs.some((p) => p.id === pack.id)) {
          return false;
        }
        set({ packs: [pack, ...packs] });
        return true;
      },
      replace: (id, pack) => {
        const { packs } = get();
        if (!packs.some((p) => p.id === id)) return false;
        const rest = packs.filter((p) => p.id !== id && p.id !== pack.id);
        set({ packs: [pack, ...rest] });
        return true;
      },
      remove: (id) => set((s) => ({ packs: s.packs.filter((p) => p.id !== id) })),
    }),
    {
      name: 'bolid.labelPacks',
      version: LABEL_PACKS_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ packs: s.packs }),
      merge: (persisted, current) => {
        const stored = sanitizeLabelPacks(persisted);
        const ids = new Set(stored.map((p) => p.id));
        const addedMeanwhile = current.packs.filter((p) => !ids.has(p.id));
        rewriteAfterHydration = addedMeanwhile.length > 0;
        return {
          ...current,
          packs: [...addedMeanwhile, ...stored].slice(0, MAX_USER_LABEL_PACKS),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) setUserLabelPacks(state.packs);
      },
    },
  ),
);

// Push every change (add / replace / remove / restore) into the registry.
useLabelPackStore.subscribe((s, prev) => {
  if (s.packs !== prev.packs) setUserLabelPacks(s.packs);
});
setUserLabelPacks(useLabelPackStore.getState().packs);

useLabelPackStore.persist.onFinishHydration((state) => {
  setUserLabelPacks(state.packs);
  if (!rewriteAfterHydration) return;
  rewriteAfterHydration = false;
  useLabelPackStore.setState({ packs: [...state.packs] });
});

/** `findLabelPack` as a hook: a lookup whose identity changes when the imported packs do, so a
 *  screen's `useMemo` / `useCallback` over it re-resolves after an import or a delete. */
export function useLabelPackFinder(): (partNumber: string | undefined | null) => LabelPack | null {
  const packs = useLabelPackStore((s) => s.packs);
  const all = useMemo(() => [...packs, ...LABEL_PACKS], [packs]);
  return useCallback((partNumber) => findLabelPackIn(all, partNumber), [all]);
}
