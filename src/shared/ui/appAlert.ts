import { Alert, Platform } from 'react-native';
import { openDialog, type DialogButton } from '@/shared/state/dialogStore';

/** The app's `Alert.alert` (plan 28 review): the system alert on the phone, the in-app
 *  `AlertDialog` in the browser — react-native-web's `Alert.alert` is an empty stub, so a confirm
 *  or a format choice routed through it would silently do nothing there. Same arguments as
 *  `Alert.alert`; use this everywhere instead of it (ESLint enforces). */
export function appAlert(
  ...args: [title: string, message?: string, buttons?: DialogButton[]]
): void {
  if (Platform.OS === 'web') openDialog(...args);
  // Forwarded as given (no padded `undefined`s), exactly as the call sites used to call it.
  // eslint-disable-next-line no-restricted-properties -- the one sanctioned call
  else Alert.alert(...args);
}
