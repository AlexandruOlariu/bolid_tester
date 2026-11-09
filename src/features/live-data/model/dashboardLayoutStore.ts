/** Per-vehicle dashboard customization: which gauges/cards show and in what order. The layout is a
 *  light set of *overrides* (an explicit order + a hidden set) keyed by a stable item id, NOT a
 *  frozen list of items — so a PID the ECU only starts reporting later still appears by default, and
 *  a car with no saved layout shows its fuel preset (`presetFor`, plan 07). Persisted per profile id via the
 *  shared file storage with debounced writes (key `bolid.dashboard-layout`). The ordering/visibility
 *  math is pure and lives in dashboardLayout.ts (unit-tested there). See docs/features/live-data.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage, debouncedStorage } from '@/shared/state/persistStorage';
import { EMPTY_LAYOUT, moveInOrder, toggleInSet, type ProfileLayout } from './dashboardLayout';

export * from './dashboardLayout';

const LAYOUT_PERSIST_DEBOUNCE_MS = 500;

interface DashboardLayoutState {
  byProfile: Record<string, ProfileLayout>;
  /** The (possibly empty) layout for a profile — always returns a usable object. */
  layoutFor: (profileId: string) => ProfileLayout;
  /** Replace a profile's explicit order (e.g. after a reorder over the full candidate list). */
  setOrder: (profileId: string, order: string[]) => void;
  /** Toggle one item's visibility for a profile. `base` is the layout shown while the profile has
   *  none saved (its fuel preset, plan 07), so hiding the first item keeps the preset's order. */
  toggleHidden: (profileId: string, id: string, base?: ProfileLayout) => void;
  /** Move one item up/down within the current full ordered id list and persist the new order. */
  move: (profileId: string, orderedIds: string[], id: string, dir: -1 | 1) => void;
  /** Reset a profile to the default: its fuel preset (or the built-in order), nothing hidden. */
  reset: (profileId: string) => void;
}

export const useDashboardLayoutStore = create<DashboardLayoutState>()(
  persist(
    (set, get) => ({
      byProfile: {},
      layoutFor: (profileId) => get().byProfile[profileId] ?? EMPTY_LAYOUT,
      setOrder: (profileId, order) =>
        set((s) => {
          const cur = s.byProfile[profileId] ?? EMPTY_LAYOUT;
          return { byProfile: { ...s.byProfile, [profileId]: { ...cur, order } } };
        }),
      toggleHidden: (profileId, id, base) =>
        set((s) => {
          const cur = s.byProfile[profileId] ?? base ?? EMPTY_LAYOUT;
          return {
            byProfile: {
              ...s.byProfile,
              [profileId]: { ...cur, hidden: toggleInSet(cur.hidden, id) },
            },
          };
        }),
      move: (profileId, orderedIds, id, dir) =>
        set((s) => {
          const cur = s.byProfile[profileId] ?? EMPTY_LAYOUT;
          return {
            byProfile: {
              ...s.byProfile,
              [profileId]: { ...cur, order: moveInOrder(orderedIds, id, dir) },
            },
          };
        }),
      reset: (profileId) =>
        set((s) => {
          const next = { ...s.byProfile };
          delete next[profileId];
          return { byProfile: next };
        }),
    }),
    {
      name: 'bolid.dashboard-layout',
      version: 1,
      storage: createJSONStorage(() =>
        debouncedStorage(fileStateStorage, LAYOUT_PERSIST_DEBOUNCE_MS),
      ),
      partialize: (s) => ({ byProfile: s.byProfile }),
    },
  ),
);
