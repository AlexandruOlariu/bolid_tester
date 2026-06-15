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

const DIR = documentDirectory ?? cacheDirectory ?? '';

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
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    if (!DIR) return;
    try {
      await writeAsStringAsync(fileFor(name), value);
    } catch {
      // best-effort persistence — ignore write failures
    }
  },
  removeItem: async (name) => {
    if (!DIR) return;
    try {
      await deleteAsync(fileFor(name), { idempotent: true });
    } catch {
      // ignore
    }
  },
};
