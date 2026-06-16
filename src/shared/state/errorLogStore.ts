/** The "logging zone": a persistent, capped store of errors the app has hit, so they can be reviewed
 *  and exported to fix later. File-backed (expo-file-system) via the shared persist storage, like the
 *  history store. Use the module-level `logError(...)` from anywhere (services, hooks, catch blocks);
 *  it works without React. `installGlobalErrorHandlers()` additionally captures uncaught errors and
 *  unhandled promise rejections. See docs/features/error-log.md. */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStateStorage } from './persistStorage';
import { buildLoggedError, type LoggedError, type LogErrorInput } from '@/shared/lib/errorLog';

/** Hard cap on retained errors — newest kept, oldest dropped, so the file can't grow unbounded. */
export const MAX_ERRORS = 500;

interface ErrorLogState {
  errors: LoggedError[];
  log: (input: LogErrorInput) => LoggedError;
  remove: (id: string) => void;
  clear: () => void;
}

export const useErrorLogStore = create<ErrorLogState>()(
  persist(
    (set) => ({
      errors: [],
      log: (input) => {
        const rec = buildLoggedError(input);
        set((s) => ({ errors: [rec, ...s.errors].slice(0, MAX_ERRORS) }));
        return rec;
      },
      remove: (id) => set((s) => ({ errors: s.errors.filter((e) => e.id !== id) })),
      clear: () => set({ errors: [] }),
    }),
    {
      name: 'bolid.errors',
      version: 1,
      storage: createJSONStorage(() => fileStateStorage),
    },
  ),
);

/** Record an error from anywhere (no hook needed). Mirrors to the console so it is still visible in
 *  dev logs. Never throws — logging an error must not itself crash the caller. */
export function logError(input: LogErrorInput): void {
  try {
    const rec = useErrorLogStore.getState().log(input);
    const tag = `[${rec.severity}] ${rec.source}`;
    if (rec.severity === 'warning') console.warn(tag, rec.message);
    else console.error(tag, rec.message);
  } catch {
    // The logging zone must be best-effort — swallow any storage/serialisation failure.
  }
}

interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

let installed = false;

/** Capture otherwise-unhandled errors into the logging zone. Idempotent; safe to call at app start.
 *  Chains to any existing handler so the default red-box / crash behaviour is preserved. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  const g = globalThis as unknown as {
    ErrorUtils?: ErrorUtilsLike;
    addEventListener?: (type: string, cb: (ev: unknown) => void) => void;
    HermesInternal?: unknown;
  };

  // React Native: ErrorUtils owns the global JS exception handler.
  const eu = g.ErrorUtils;
  if (eu && typeof eu.setGlobalHandler === 'function') {
    const prev = eu.getGlobalHandler?.();
    eu.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      logError({ source: 'global', error, severity: isFatal ? 'fatal' : 'error', context: { isFatal: !!isFatal } });
      prev?.(error, isFatal);
    });
  }

  // Web / environments with an event target: unhandled promise rejections.
  if (typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (ev: unknown) => {
      const reason = (ev as { reason?: unknown })?.reason ?? ev;
      logError({ source: 'unhandledRejection', error: reason, severity: 'error' });
    });
  }
}
