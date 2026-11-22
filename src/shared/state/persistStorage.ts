/** A zustand `StateStorage` backed by a JSON file in the app's document directory, using the
 *  already-installed **expo-file-system** (no extra native dependency, so it works in the existing
 *  build after a reload). Best-effort: any filesystem error degrades to "no persistence" rather than
 *  crashing.
 *
 *  On web (plan 28) there is no document directory, so the same storage falls back to the browser's
 *  `localStorage`, under the store's own `bolid.<area>` key. Without either (a sandboxed iframe with
 *  site data blocked) it is a no-op and the app runs with in-memory state.
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

/** The slice of the browser's Web Storage (`window.localStorage`) the web backend uses. */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's `localStorage`, or null when there is none (native, Node) or it is blocked —
 *  reading the property itself throws a `SecurityError` when the browser denies site data. */
export function browserLocalStorage(): WebStorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: Partial<WebStorageLike> }).localStorage;
    return ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function'
      ? (ls as WebStorageLike)
      : null;
  } catch {
    return null;
  }
}

/** Where persisted stores live on this platform: a JSON file per store (native), the browser's
 *  `localStorage` (web — there is no document directory), or nowhere (in-memory only). */
export type PersistBackend = 'file' | 'localStorage' | 'none';

export function persistBackend(): PersistBackend {
  if (DIR) return 'file';
  return browserLocalStorage() ? 'localStorage' : 'none';
}

/** A `StateStorage` over Web Storage (plan 28): the key is the store's `name` (`bolid.settings`, …),
 *  the value the same JSON string the file backend writes. Every call is wrapped like the file
 *  backend's: a quota error or a blocked storage is logged as a `persist` warning and degrades to
 *  "not persisted", never a crash. `getStorage` is injectable for tests. */
export function webStateStorage(
  getStorage: () => WebStorageLike | null = browserLocalStorage,
): StateStorage {
  return {
    getItem: (name) => {
      const ls = getStorage();
      if (!ls) return null;
      try {
        return ls.getItem(name);
      } catch (e) {
        logPersistFailure(name, 'read', e);
        return null;
      }
    },
    setItem: (name, value) => {
      const ls = getStorage();
      if (!ls) return;
      try {
        ls.setItem(name, value);
      } catch (e) {
        // QuotaExceededError (the ~5 MB per-origin budget) or storage blocked mid-session.
        logPersistFailure(name, 'write', e);
      }
    },
    removeItem: (name) => {
      const ls = getStorage();
      if (!ls) return;
      try {
        ls.removeItem(name);
      } catch (e) {
        logPersistFailure(name, 'remove', e);
      }
    },
  };
}

const webBackend = webStateStorage();

/** The storage every durable store uses: the document-directory file on native, `localStorage` on
 *  web (no document directory there), else a no-op. Kept under its historical name. */
export const fileStateStorage: StateStorage = {
  getItem: async (name) => {
    if (!DIR) return webBackend.getItem(name);
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
    if (!DIR) return webBackend.setItem(name, value);
    try {
      await writeAsStringAsync(fileFor(name), value);
    } catch (e) {
      // best-effort persistence — the write is lost, so record it rather than fail silently.
      logPersistFailure(name, 'write', e);
    }
  },
  removeItem: async (name) => {
    if (!DIR) return webBackend.removeItem(name);
    try {
      await deleteAsync(fileFor(name), { idempotent: true });
    } catch (e) {
      logPersistFailure(name, 'remove', e);
    }
  },
};

/** A debounced storage can also write its pending values *now* (`flushNow`). */
export interface DebouncedStateStorage extends StateStorage {
  /** Write the pending value of `name` (or of every key) immediately and cancel its timer; resolves
   *  once the inner writes have landed. */
  flushNow: (name?: string) => Promise<void>;
}

/** Every debounced storage created so far, so a backup can flush them all (`flushPendingWrites`). */
const liveDebounced = new Set<DebouncedStateStorage>();

/** Wrap a `StateStorage` so `setItem` writes are **debounced** per key: rapid successive writes
 *  coalesce into a single trailing flush `ms` after the last one. zustand-persist rewrites the whole
 *  JSON file on every state mutation; for stores that mutate in bursts (history, trips) that is a lot
 *  of redundant `JSON.stringify` + file writes, and only the final state matters (findings F6/F7).
 *
 *  Accepted loss window: up to `ms` of the most-recent state can be lost if the process is killed
 *  mid-debounce. That is fine for history/trips (a just-added entry re-derives on the next action)
 *  but NOT for the error log, whose whole job is to survive a crash — it stays on the un-debounced
 *  `fileStateStorage` (see the fatal-error 150 ms flush in errorLogStore). `getItem` is passed
 *  straight through (hydration must be immediate); `removeItem` cancels any pending write for that
 *  key first so a clear can't be undone by a stale flush landing after it. `flushNow` writes the
 *  pending values at once (the backup reads complete files, plan 18). */
export function debouncedStorage(inner: StateStorage, ms: number): DebouncedStateStorage {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, string>();

  const flush = (name: string): Promise<void> => {
    const t = timers.get(name);
    if (t) clearTimeout(t);
    timers.delete(name);
    const value = pending.get(name);
    if (value === undefined) return Promise.resolve();
    pending.delete(name);
    return Promise.resolve(inner.setItem(name, value)).then(
      () => undefined,
      () => undefined,
    );
  };

  const cancel = (name: string): void => {
    const t = timers.get(name);
    if (t) clearTimeout(t);
    timers.delete(name);
    pending.delete(name);
  };

  const storage: DebouncedStateStorage = {
    getItem: (name) => inner.getItem(name),
    setItem: (name, value) => {
      pending.set(name, value);
      const existing = timers.get(name);
      if (existing) clearTimeout(existing);
      timers.set(
        name,
        setTimeout(() => void flush(name), ms),
      );
    },
    removeItem: (name) => {
      cancel(name);
      return inner.removeItem(name);
    },
    flushNow: async (name) => {
      const names = name === undefined ? [...pending.keys()] : [name];
      await Promise.all(names.map(flush));
    },
  };
  liveDebounced.add(storage);
  return storage;
}

/** Write every debounced store's pending value now (backup and restore, plan 18): the backup then
 *  reads complete files, and no stale flush can land on a file the restore just wrote. */
export async function flushPendingWrites(): Promise<void> {
  await Promise.all([...liveDebounced].map((s) => s.flushNow()));
}
