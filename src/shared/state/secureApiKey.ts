/** Secure storage for the AI `apiKey` (finding F8). The key used to be persisted in the plain
 *  `bolid.settings` JSON file in the document directory (readable via device backups); it now lives
 *  in the OS keystore via **expo-secure-store** (Keychain on iOS, the Keystore-backed
 *  EncryptedSharedPreferences on Android). The settings store keeps the key only in runtime state and
 *  re-hydrates it from here on startup — see settingsStore.ts and docs/features/settings.md.
 *
 *  Like `shared/notify`, the native module is loaded through a *variable* import specifier so this
 *  file type-checks and runs with or without the optional dependency installed. When the module is
 *  unavailable (Expo Go without a dev-client, web, unit tests) every call degrades to a best-effort
 *  no-op and the key simply lives in memory for the session (documented degradation). */
import { logError } from '@/shared/state/errorLogStore';

const SECURE_STORE_MODULE = 'expo-secure-store';
/** Keystore entry key; kept stable so a stored key survives app updates. */
export const API_KEY_STORE_KEY = 'bolid.ai.apiKey';

/** Load expo-secure-store, or null when it is simply not installed / not available (tests, web, Expo
 *  Go). A missing module is an expected no-op and must NOT be logged; only a present-but-failing API
 *  call is a real failure. */
async function loadSecureStore(): Promise<any> {
  try {
    return await import(SECURE_STORE_MODULE);
  } catch {
    return null;
  }
}

/** Read the stored apiKey, or null when there is none / the keystore is unavailable. */
export async function secureGetApiKey(): Promise<string | null> {
  const SecureStore = await loadSecureStore();
  if (!SecureStore) return null;
  try {
    const v = await SecureStore.getItemAsync(API_KEY_STORE_KEY);
    return typeof v === 'string' ? v : null;
  } catch (e) {
    logError({ source: 'secure-store/get', error: e, severity: 'warning' });
    return null;
  }
}

/** Persist the apiKey (or, for an empty value, delete it). Returns true only when the keystore
 *  actually accepted the write, so callers can distinguish a real save from the degraded
 *  in-memory-only path (module unavailable / write rejected). */
export async function secureSetApiKey(key: string): Promise<boolean> {
  const SecureStore = await loadSecureStore();
  if (!SecureStore) return false;
  try {
    if (key) await SecureStore.setItemAsync(API_KEY_STORE_KEY, key);
    else await SecureStore.deleteItemAsync(API_KEY_STORE_KEY);
    return true;
  } catch (e) {
    logError({ source: 'secure-store/set', error: e, severity: 'warning' });
    return false;
  }
}

/** Return a copy of the AI settings with the apiKey blanked — the shape written to the plain settings
 *  file, so the secret never lands there (it lives in the keystore instead). Generic over the settings
 *  shape to stay a pure leaf helper with no store import; exported for unit testing. */
export function redactApiKey<T extends { apiKey: string }>(ai: T): T {
  return { ...ai, apiKey: '' };
}

/** The action to take once the settings store has hydrated, decided purely from the key found in the
 *  freshly-hydrated settings blob (`blobKey` — a legacy plaintext key, or '') and the key already in
 *  the keystore (`secureKey`). Pure + exhaustive so it is unit-tested without any native module:
 *   - a legacy plaintext key present -> `migrate` it into the keystore and strip it from the file,
 *   - else a keystore key present    -> `load` it into runtime state,
 *   - else                           -> `none`. */
export type ApiKeyHydration =
  | { action: 'migrate'; key: string }
  | { action: 'load'; key: string }
  | { action: 'none' };

export function planApiKeyHydration(
  blobKey: string | null | undefined,
  secureKey: string | null | undefined,
): ApiKeyHydration {
  const legacy = (blobKey ?? '').trim();
  if (legacy) return { action: 'migrate', key: legacy };
  const secure = (secureKey ?? '').trim();
  if (secure) return { action: 'load', key: secure };
  return { action: 'none' };
}
