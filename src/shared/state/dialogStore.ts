/** The in-app replacement for `Alert.alert` in the browser (plan 28 review). react-native-web's
 *  `Alert.alert` is an empty stub, so every confirm / choice / notice routed through it silently did
 *  nothing on the web. `appAlert()` (shared/ui) queues the alert here on the web and the
 *  `AlertDialog` host (mounted once in the root layout) renders the head of the queue. Pure and
 *  in-memory; the native app keeps the system alert and never touches this store. */
import { create } from 'zustand';

/** One alert button — the subset of React Native's `AlertButton` the app uses. */
export interface DialogButton {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface Dialog {
  id: number;
  title: string;
  message?: string;
  /** Never empty: an alert given no buttons gets a single "OK", as on the phone (a button without
   *  `text`, which `AlertDialog` labels with the translated `actions.ok`, plan 11). */
  buttons: DialogButton[];
}

interface DialogState {
  /** Pending alerts, oldest first; the first is on screen. */
  queue: Dialog[];
}

export const useDialogStore = create<DialogState>(() => ({ queue: [] }));

let seq = 0;

/** Queue an alert (shown after any already on screen). */
export function openDialog(title: string, message?: string, buttons?: DialogButton[]): void {
  const dialog: Dialog = {
    id: ++seq,
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{}],
  };
  useDialogStore.setState((s) => ({ queue: [...s.queue, dialog] }));
}

/** Close the dialog on screen through button `index`, then run that button's handler — after the
 *  close, so a handler that opens a follow-up alert (two-step confirms) shows it next. */
export function pressDialogButton(id: number, index: number): void {
  const current = useDialogStore.getState().queue[0];
  if (!current || current.id !== id) return;
  useDialogStore.setState((s) => ({ queue: s.queue.slice(1) }));
  current.buttons[index]?.onPress?.();
}

/** Dismiss the dialog on screen without choosing (Escape, a tap outside): runs the `cancel`
 *  button's handler when there is one. */
export function dismissDialog(id: number): void {
  const current = useDialogStore.getState().queue[0];
  if (!current || current.id !== id) return;
  const cancel = current.buttons.findIndex((b) => b.style === 'cancel');
  if (cancel >= 0) pressDialogButton(id, cancel);
  else useDialogStore.setState((s) => ({ queue: s.queue.slice(1) }));
}

/** Drop every pending dialog without running handlers (tests, reset). */
export function clearDialogs(): void {
  useDialogStore.setState({ queue: [] });
}
