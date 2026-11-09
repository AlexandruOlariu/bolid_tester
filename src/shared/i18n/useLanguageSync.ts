import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { logError } from '@/shared/state/errorLogStore';
import { initI18n } from './index';

/** Keeps the UI language in step with Settings → General → Language (plan 11). Waits for the
 *  settings file to hydrate (the stored preference), resolves it (`system` → the device language),
 *  applies it, and re-applies on every change — live, no restart. Returns `true` once the first
 *  language is applied: the root layout keeps the splash up until then, so a Romanian phone never
 *  sees an English frame. */
export function useLanguageSync(): boolean {
  const pref = useSettingsStore((s) => s.language);
  const [hydrated, setHydrated] = useState(() => useSettingsStore.persist.hasHydrated());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    const unsub = useSettingsStore.persist.onFinishHydration(() => setHydrated(true));
    if (useSettingsStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    initI18n(pref)
      .catch((error: unknown) => logError({ source: 'i18n', error, severity: 'warning' }))
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [hydrated, pref]);

  return ready;
}
