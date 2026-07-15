/** Auto-reconnect backoff — the pure control flow, isolated from timers/stores so it can be unit
 *  tested. connectionService injects the real `sleep`/`attemptConnect`/abort wiring. */

/** Delay before each retry attempt (attempt 1 waits 2 s, attempt 2 waits 5 s, attempt 3 waits 10 s). */
export const RECONNECT_DELAYS_MS = [2000, 5000, 10000] as const;

export interface ReconnectDeps {
  /** Resolve after `ms` (or early, if the sequence is aborted). */
  sleep: (ms: number) => Promise<void>;
  /** Attempt a single reconnect. Resolves true on success, false (or throws) on failure. */
  attemptConnect: () => Promise<boolean>;
  /** True once the caller aborted the sequence (manual disconnect / a new manual connect). */
  isAborted: () => boolean;
  /** Notified before each attempt with the 1-based attempt index and the total, for UI messaging. */
  onAttempt?: (attempt: number, total: number) => void;
}

/** Run the backoff reconnect sequence. Returns true if an attempt connected, false if every attempt
 *  was exhausted or the sequence was aborted. All side effects are injected, so this is deterministic
 *  under fake timers. Aborts are honoured before and after each attempt so a manual action wins
 *  immediately. */
export async function runReconnect(
  deps: ReconnectDeps,
  delays: readonly number[] = RECONNECT_DELAYS_MS,
): Promise<boolean> {
  for (let i = 0; i < delays.length; i++) {
    await deps.sleep(delays[i]);
    if (deps.isAborted()) return false;
    deps.onAttempt?.(i + 1, delays.length);
    try {
      if (await deps.attemptConnect()) return true;
    } catch {
      // Attempt failed — fall through to the next backoff step.
    }
    if (deps.isAborted()) return false;
  }
  return false;
}
