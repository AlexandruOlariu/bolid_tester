/** One-at-a-time gate for the Backup section's module work (plan 24 review): creating a snapshot,
 *  restoring a module's coding, and comparing / restoring adaptation channels all drive the one
 *  shared `DiagnosticSession` with setHeader → send → resetAddressing sequences. The session itself
 *  has no lock, so two of these running together could interleave addressing and land a `2E` write
 *  on the wrong header. Every such action takes this gate first (`tryBegin`) and releases it in a
 *  `finally` (`end`); a second action started meanwhile is refused instead of queued. Not
 *  persisted. See docs/features/coding.md (backup). */
import { create } from 'zustand';

interface BackupWorkState {
  /** True while some backup-section module read or write is running. */
  busy: boolean;
  /** Take the gate; false (and nothing changes) when another action already holds it. */
  tryBegin: () => boolean;
  /** Release the gate. */
  end: () => void;
}

export const BACKUP_BUSY_MESSAGE =
  'Another module read or write is still running — wait for it to finish.';

export const useBackupWorkStore = create<BackupWorkState>((set, get) => ({
  busy: false,
  tryBegin: () => {
    if (get().busy) return false;
    set({ busy: true });
    return true;
  },
  end: () => set({ busy: false }),
}));
