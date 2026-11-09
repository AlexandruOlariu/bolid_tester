/** The list of backup files this phone wrote (plan 18): `bolid.backups`, newest first, capped at
 *  `MAX_BACKUP_RECORDS` backups the user made, plus the automatic pre-restore snapshots, counted
 *  apart (`createBackup` deletes the file of an entry that drops off). Only the file
 *  names, dates and sizes — the files themselves live in `documentDirectory/backups/`, and their
 *  URI is derived from the name at use time (`backupFileUri`): on iOS the app container path, and
 *  so `documentDirectory`, changes across app updates, so a stored absolute URI would go stale.
 *  Not part of any backup bundle (see api/registry.ts). */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from '@/shared/state/persistStorage';

export const MAX_BACKUP_RECORDS = 20;
export const BACKUPS_LIST_VERSION = 1;

export interface BackupRecord {
  /** The file's name in `documentDirectory/backups/`. */
  fileName: string;
  createdAt: number;
  bytes: number;
  /** `pre-restore`: the automatic snapshot taken before a restore (undo). */
  kind: 'backup' | 'pre-restore';
  includesTrips: boolean;
}

interface BackupListState {
  records: BackupRecord[];
  /** Add (or replace, by file name) a record at the top. */
  record: (r: BackupRecord) => void;
  remove: (fileName: string) => void;
}

/** Add `r` at the top, then keep the newest `MAX_BACKUP_RECORDS` of **each kind**: an automatic
 *  pre-restore snapshot never pushes a backup the user made off the list (whose file `createBackup`
 *  would then delete — possibly the very file being restored). Pre-restore snapshots are trimmed
 *  to the newest 3 by `prunePreRestore`; their cap here is only a backstop. */
export function withRecord(records: BackupRecord[], r: BackupRecord): BackupRecord[] {
  const all = [r, ...records.filter((x) => x.fileName !== r.fileName)];
  const seen = { backup: 0, 'pre-restore': 0 };
  return all.filter((x) => {
    const kind = x.kind === 'pre-restore' ? 'pre-restore' : 'backup';
    seen[kind]++;
    return seen[kind] <= MAX_BACKUP_RECORDS;
  });
}

export const useBackupStore = create<BackupListState>()(
  persist(
    (set) => ({
      records: [],
      record: (r) => set((s) => ({ records: withRecord(s.records, r) })),
      remove: (fileName) =>
        set((s) => ({ records: s.records.filter((x) => x.fileName !== fileName) })),
    }),
    {
      name: 'bolid.backups',
      version: BACKUPS_LIST_VERSION,
      storage: createJSONStorage(() => fileStateStorage),
      partialize: (s) => ({ records: s.records }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { records?: unknown };
        const stored = Array.isArray(p.records) ? (p.records as BackupRecord[]) : [];
        // Rebuilt field by field: drops anything else a record carries (an early build stored the
        // absolute `uri`, which goes stale when iOS moves the app container).
        let records: BackupRecord[] = stored
          .filter((r) => r && typeof r.fileName === 'string')
          .map((r) => ({
            fileName: r.fileName,
            createdAt: r.createdAt,
            bytes: r.bytes,
            kind: r.kind,
            includesTrips: r.includesTrips,
          }));
        for (const r of [...current.records].reverse()) records = withRecord(records, r);
        return { ...current, records };
      },
    },
  ),
);
