import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';

/** First-run hints are dismissible and stay dismissed across launches. We persist the *set of
 *  dismissed hint ids* (not per-hint booleans) so adding a new hint later doesn't need a migration —
 *  an unknown id is simply "not yet dismissed". Same persistStorage idiom as the other stores. */
interface OnboardingState {
  dismissed: string[];
  dismiss: (id: string) => void;
  /** Clear all dismissals — used by a "show hints again" affordance / tests. */
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      dismissed: [],
      dismiss: (id) =>
        set((s) => (s.dismissed.includes(id) ? s : { dismissed: [...s.dismissed, id] })),
      reset: () => set({ dismissed: [] }),
    }),
    {
      name: 'bolid.onboarding',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ dismissed: s.dismissed }),
    },
  ),
);
