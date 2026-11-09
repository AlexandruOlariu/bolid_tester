/** A single, short-lived message at the bottom of the screen (plan 28) — the app had no toast. Used
 *  where an action finishes without a screen of its own to report on, e.g. a file export the web
 *  build cannot do yet. In-memory only; `Toast` (shared/ui) renders it, mounted once in the root
 *  layout. A newer toast replaces the current one. */
import { create } from 'zustand';

/** Shown when a file export / import that needs the phone's file system is tapped in the browser. */
export const NOT_ON_WEB_YET =
  'Not available on web yet — saving or opening this file needs the Android app.';

/** How long a toast stays up unless dismissed. */
export const TOAST_MS = 5000;

export interface Toast {
  id: number;
  message: string;
}

interface ToastState {
  toast: Toast | null;
}

export const useToastStore = create<ToastState>(() => ({ toast: null }));

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Show `message` for `ms`, replacing any toast already up. */
export function showToast(message: string, ms: number = TOAST_MS): void {
  if (timer) clearTimeout(timer);
  const toast = { id: ++seq, message };
  useToastStore.setState({ toast });
  timer = setTimeout(() => {
    timer = null;
    if (useToastStore.getState().toast?.id === toast.id) useToastStore.setState({ toast: null });
  }, ms);
}

/** Dismiss the current toast (its close button). */
export function hideToast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  useToastStore.setState({ toast: null });
}
