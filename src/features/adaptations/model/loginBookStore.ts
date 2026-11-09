/** The **login book** (plan 22): KWP module login codes the user chose to remember for a
 *  *registry* car (a garage car keeps its codes on its own `UserVehicle.loginCodes`). Keyed by
 *  `historyVehicleKey` — the VIN when the car reported one, else the profile id. Persisted as
 *  `bolid.loginBook` (v1); never in `bolid.settings`. Codes typed for a single write are never
 *  stored. See docs/features/adaptations.md → "Code book". */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';
import {
  removeLoginCode,
  sanitizeLoginCodes,
  upsertLoginCode,
  type LoginCodeEntry,
} from '@/shared/vehicles';

export const LOGIN_BOOK_VERSION = 1;

interface LoginBookState {
  /** Car key (`vin:…` / `id:…`) -> its code book. */
  byVehicle: Record<string, LoginCodeEntry[]>;
  remember: (key: string, entry: LoginCodeEntry) => void;
  forget: (key: string, address: string) => void;
}

/** Keep only well-formed books from a persisted blob. */
export function sanitizeLoginBook(persisted: unknown): Record<string, LoginCodeEntry[]> {
  const raw = (persisted as { byVehicle?: unknown } | null)?.byVehicle;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, LoginCodeEntry[]> = {};
  for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
    const codes = sanitizeLoginCodes(list);
    if (codes) out[key] = codes;
  }
  return out;
}

export const useLoginBookStore = create<LoginBookState>()(
  persist(
    (set) => ({
      byVehicle: {},
      remember: (key, entry) =>
        set((s) => ({
          byVehicle: { ...s.byVehicle, [key]: upsertLoginCode(s.byVehicle[key], entry) },
        })),
      forget: (key, address) =>
        set((s) => {
          const rest = removeLoginCode(s.byVehicle[key], address);
          const byVehicle = { ...s.byVehicle };
          if (rest.length) byVehicle[key] = rest;
          else delete byVehicle[key];
          return { byVehicle };
        }),
    }),
    {
      name: 'bolid.loginBook',
      version: LOGIN_BOOK_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ byVehicle: s.byVehicle }),
      migrate: (persisted) => ({ byVehicle: sanitizeLoginBook(persisted) }),
      merge: (persisted, current) => ({
        ...current,
        byVehicle: { ...sanitizeLoginBook(persisted), ...current.byVehicle },
      }),
    },
  ),
);
