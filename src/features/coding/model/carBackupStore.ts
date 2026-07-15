/** Persistent store of full-car coding backups ("clone my car" snapshots). File-backed via the
 *  shared persist storage (key 'bolid.carBackups'), capped and debounced exactly like scanHistoryStore
 *  / historyStore (finding F7). A backup is a compact, serializable CarBackup snapshot. See
 *  docs/features/coding.md (backup). */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage, debouncedStorage } from '@/shared/state/persistStorage';
import type { CarBackup } from '../api/carBackup';

/** Cap on retained snapshots — newest kept, oldest dropped (each is a whole-car snapshot, so a
 *  tighter cap than history/scans). */
export const MAX_CAR_BACKUPS = 10;

const BACKUPS_PERSIST_DEBOUNCE_MS = 500;

interface CarBackupState {
  backups: CarBackup[];
  save: (backup: CarBackup) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function withBackup(backups: CarBackup[], backup: CarBackup): CarBackup[] {
  return [backup, ...backups].slice(0, MAX_CAR_BACKUPS);
}

export const useCarBackupStore = create<CarBackupState>()(
  persist(
    (set) => ({
      backups: [],
      save: (backup) => set((s) => ({ backups: withBackup(s.backups, backup) })),
      remove: (id) => set((s) => ({ backups: s.backups.filter((b) => b.id !== id) })),
      clear: () => set({ backups: [] }),
    }),
    {
      name: 'bolid.carBackups',
      storage: createJSONStorage(() =>
        debouncedStorage(fileStateStorage, BACKUPS_PERSIST_DEBOUNCE_MS),
      ),
      // Concatenate snapshots saved during the async rehydration window with the persisted ones
      // (newest-first, deduped by id, capped) — the same safety net scanHistoryStore uses.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CarBackupState>;
        const persistedBackups = Array.isArray(p.backups) ? p.backups : [];
        const seen = new Set<string>();
        const backups: CarBackup[] = [];
        for (const b of [...current.backups, ...persistedBackups]) {
          if (b && !seen.has(b.id)) {
            seen.add(b.id);
            backups.push(b);
          }
        }
        return { ...current, ...p, backups: backups.slice(0, MAX_CAR_BACKUPS) };
      },
    },
  ),
);
