/** A zustand `StateStorage` backed by a JSON file in the app's document directory, using the
 *  already-installed **expo-file-system** (no extra native dependency, so it works in the existing
 *  build after a reload). Best-effort: any filesystem error degrades to "no persistence" rather than
 *  crashing, and on platforms without a document directory (e.g. web) it is a silent no-op.
 *
 *  We use the `legacy` entry point because its read/write-string API is stable and synchronous to
 *  reason about; see docs/features/settings.md. */
import type { StateStorage } from 'zustand/middleware';
import {
  documentDirectory,
  cacheDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
} from 'expo-file-system/legacy';
import type { LogErrorInput } from '@/shared/lib/errorLog';

const DIR = documentDirectory ?? cacheDirectory ?? '';

/** The error logger is *injected* (errorLogStore calls `setPersistLogger` when it loads) rather than
 *  imported, to avoid a persistStorage <-> errorLogStore module-init cycle. Null until wired, in which
 *  case a persist failure stays a silent no-op — best-effort, exactly as before. */
let persistLogger: ((input: LogErrorInput) => void) | null = null;
export function setPersistLogger(fn: ((input: LogErrorInput) => void) | null): void {
  persistLogger = fn;
}

/** The error-log store persists through this same storage (key below). Logging a failure for *that*
 *  key would re-enter the store and re-trigger this write, so we never log for it — otherwise a broken
 *  filesystem would spin an infinite write/log loop. Other keys log a `persist` warning so a silent
 *  data-loss (settings, history, maintenance, etc. failing to save) shows up in the Error Log. */
const ERROR_STORE_KEY = 'bolid.errors';

function logPersistFailure(name: string, op: 'read' | 'write' | 'remove', error: unknown): void {
  if (name === ERROR_STORE_KEY) return;
  persistLogger?.({ source: 'persist', error, severity: 'warning', context: { store: name, op } });
}

function fileFor(name: string): string {
  return `${DIR}${name.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

export const fileStateStorage: StateStorage = {
  getItem: async (name) => {
    if (!DIR) return null;
    try {
      const uri = fileFor(name);
      const info = await getInfoAsync(uri);
      if (!info.exists) return null;
      return await readAsStringAsync(uri);
    } catch (e) {
      // Degrades to "no persisted state", but a corrupt/unreadable file is worth surfacing.
      logPersistFailure(name, 'read', e);
      return null;
    }
  },
  setItem: async (name, value) => {
    if (!DIR) return;
    try {
      await writeAsStringAsync(fileFor(name), value);
    } catch (e) {
      // best-effort persistence — the write is lost, so record it rather than fail silently.
      logPersistFailure(name, 'write', e);
    }
  },
  removeItem: async (name) => {
    if (!DIR) return;
    try {
      await deleteAsync(fileFor(name), { idempotent: true });
    } catch (e) {
      logPersistFailure(name, 'remove', e);
    }
  },
};
