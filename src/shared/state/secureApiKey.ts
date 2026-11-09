/** Secure storage for the AI API keys (finding F8, per provider since plan 19). The key used to be
 *  persisted in the plain `bolid.settings` JSON file in the document directory (readable via device
 *  backups); it now lives in the OS keystore via **expo-secure-store** (Keychain on iOS, the
 *  Keystore-backed EncryptedSharedPreferences on Android), **one slot per provider**
 *  (`bolid.ai.apiKey.<provider>`), so an OpenAI key and an Anthropic key never overwrite each other.
 *  The settings store keeps only the current provider's key in runtime state and re-hydrates it from
 *  here on startup and on every provider switch — see settingsStore.ts and docs/features/settings.md.
 *
 *  Like `shared/notify`, the native module is loaded through a *variable* import specifier so this
 *  file type-checks and runs with or without the optional dependency installed. When the module is
 *  unavailable (Expo Go without a dev-client, web, unit tests) every call degrades to a best-effort
 *  no-op and the key simply lives in memory for the session (documented degradation). */
import { logError } from '@/shared/state/errorLogStore';
import type { AiProviderId } from '@/shared/obd-core';

const SECURE_STORE_MODULE = 'expo-secure-store';
/** The single pre-plan-19 keystore entry. Read once at startup and moved to the current provider's
 *  slot (see {@link planApiKeyHydration}), then deleted. */
export const API_KEY_STORE_KEY = 'bolid.ai.apiKey';

/** Keystore entry for one provider's key; kept stable so a stored key survives app updates. */
export function apiKeyStoreKey(provider: AiProviderId): string {
  return `${API_KEY_STORE_KEY}.${provider}`;
}

/** The slice of expo-secure-store this file uses. */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let injectedStore: SecureStoreLike | null | undefined;

/** Replace the keystore module (tests: an in-memory double, so they never depend on the variable
 *  specifier `import()` resolving under Jest), or pass undefined to load the real one again. */
export function setSecureStoreModule(store: SecureStoreLike | null | undefined): void {
  injectedStore = store;
}

/** Load expo-secure-store, or null when it is simply not installed / not available (tests, web, Expo
 *  Go). A missing module is an expected no-op and must NOT be logged; only a present-but-failing API
 *  call is a real failure. */
async function loadSecureStore(): Promise<any> {
  if (injectedStore !== undefined) return injectedStore;
  try {
    return await import(SECURE_STORE_MODULE);
  } catch {
    return null;
  }
}

async function getItem(storeKey: string): Promise<string | null> {
  const SecureStore = await loadSecureStore();
  if (!SecureStore) return null;
  try {
    const v = await SecureStore.getItemAsync(storeKey);
    return typeof v === 'string' ? v : null;
  } catch (e) {
    logError({ source: 'secure-store/get', error: e, severity: 'warning' });
    return null;
  }
}

async function setItem(storeKey: string, value: string): Promise<boolean> {
  const SecureStore = await loadSecureStore();
  if (!SecureStore) return false;
  try {
    if (value) await SecureStore.setItemAsync(storeKey, value);
    else await SecureStore.deleteItemAsync(storeKey);
    return true;
  } catch (e) {
    logError({ source: 'secure-store/set', error: e, severity: 'warning' });
    return false;
  }
}

/** Read a provider's stored key, or null when there is none / the keystore is unavailable. */
export function secureGetApiKey(provider: AiProviderId): Promise<string | null> {
  return getItem(apiKeyStoreKey(provider));
}

/** Persist a provider's key (or, for an empty value, delete it). Returns true only when the keystore
 *  actually accepted the write, so callers can distinguish a real save from the degraded
 *  in-memory-only path (module unavailable / write rejected). */
export function secureSetApiKey(provider: AiProviderId, key: string): Promise<boolean> {
  return setItem(apiKeyStoreKey(provider), key);
}

/** Read the legacy single-slot key (pre plan 19), or null. */
export function secureGetLegacyApiKey(): Promise<string | null> {
  return getItem(API_KEY_STORE_KEY);
}

/** Delete the legacy single-slot key once it has been moved. */
export function secureDeleteLegacyApiKey(): Promise<boolean> {
  return setItem(API_KEY_STORE_KEY, '');
}

/** Return a copy of the AI settings with the apiKey blanked — the shape written to the plain settings
 *  file, so the secret never lands there (it lives in the keystore instead). Generic over the settings
 *  shape to stay a pure leaf helper with no store import; exported for unit testing. */
export function redactApiKey<T extends { apiKey: string }>(ai: T): T {
  return { ...ai, apiKey: '' };
}

/** The action to take once the settings store has hydrated, decided purely from the current
 *  `provider`, the key found in the freshly-hydrated settings blob (`blobKey`: a pre-F8 plaintext
 *  key, or ''), that provider's keystore slot (`secureKey`) and the legacy single slot
 *  (`legacyKey`, pre plan 19). Pure + exhaustive so it is unit-tested without any native module:
 *   - a plaintext key in the file        -> `migrate` it into the provider's slot (`from: 'file'`)
 *                                           and strip it from the file,
 *   - else the provider's slot has a key -> `load` it into runtime state,
 *   - else a legacy single-slot key      -> `migrate` it into the provider's slot
 *                                           (`from: 'legacy-slot'`),
 *   - else                               -> `none`.
 *  In every case a non-empty legacy slot is deleted afterwards (`dropLegacy`), so the keystore ends
 *  up with exactly one slot per provider. */
export type ApiKeyHydration =
  | {
      action: 'migrate';
      provider: AiProviderId;
      key: string;
      from: 'file' | 'legacy-slot';
      dropLegacy: boolean;
    }
  | { action: 'load'; provider: AiProviderId; key: string; dropLegacy: boolean }
  | { action: 'none'; provider: AiProviderId; dropLegacy: boolean };

export function planApiKeyHydration(
  provider: AiProviderId,
  blobKey: string | null | undefined,
  secureKey: string | null | undefined,
  legacyKey?: string | null,
): ApiKeyHydration {
  const dropLegacy = !!(legacyKey ?? '').trim();
  const plaintext = (blobKey ?? '').trim();
  if (plaintext) return { action: 'migrate', provider, key: plaintext, from: 'file', dropLegacy };
  const secure = (secureKey ?? '').trim();
  if (secure) return { action: 'load', provider, key: secure, dropLegacy };
  const legacy = (legacyKey ?? '').trim();
  if (legacy) return { action: 'migrate', provider, key: legacy, from: 'legacy-slot', dropLegacy };
  return { action: 'none', provider, dropLegacy };
}
