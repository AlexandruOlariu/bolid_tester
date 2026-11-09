/** App-shell wiring of the opt-in crash reporter (plan 31), mounted once by `src/app/_layout.tsx`
 *  as `<CrashReportingHost />`:
 *  - starts it with the stored Settings → Privacy choice (off by default; a no-op without a DSN),
 *  - follows the switch (`setCrashReportingEnabled`) — including the change hydration makes when
 *    the settings file loads after the first render,
 *  - adds the only two breadcrumb kinds: the screen path (`nav`) and connection status changes
 *    (`connection`),
 *  - keeps the known VINs (connected car, garage) in the scrubber's list.
 *  Lives apart from `crashReporting.ts` so that module stays free of stores and React (errorLogStore
 *  imports it). The hook reads `usePathname()`, so it re-renders on every navigation; it runs in the
 *  headless `CrashReportingHost` rather than in `RootLayout`, which would otherwise re-render the
 *  whole navigator (Tabs, EngineHost) on each screen change. */
import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import {
  addCrashBreadcrumb,
  setCrashReportingEnabled,
  setCrashScrubVins,
  startCrashReporting,
} from './crashReporting';

function collectVins(): string[] {
  const vins = new Set<string>();
  const sessionVin = useSessionStore.getState().info?.vin;
  if (sessionVin) vins.add(sessionVin);
  for (const v of useGarageStore.getState().vehicles) {
    if (v.learned?.vin) vins.add(v.learned.vin);
  }
  return [...vins];
}

export function useCrashReporting(): void {
  const pathname = usePathname();

  useEffect(() => {
    setCrashScrubVins(collectVins());
    void startCrashReporting(useSettingsStore.getState().crashReports);
    const offSettings = useSettingsStore.subscribe((s, prev) => {
      if (s.crashReports !== prev.crashReports) setCrashReportingEnabled(s.crashReports);
    });
    const offSession = useSessionStore.subscribe((s, prev) => {
      if (s.status !== prev.status) addCrashBreadcrumb('connection', s.status);
      if (s.info?.vin !== prev.info?.vin) setCrashScrubVins(collectVins());
    });
    const offGarage = useGarageStore.subscribe((s, prev) => {
      if (s.vehicles !== prev.vehicles) setCrashScrubVins(collectVins());
    });
    return () => {
      offSettings();
      offSession();
      offGarage();
    };
  }, []);

  useEffect(() => {
    if (pathname) addCrashBreadcrumb('nav', pathname);
  }, [pathname]);
}

/** Headless host for `useCrashReporting()`: renders nothing, and keeps the per-navigation re-render
 *  (`usePathname`) inside itself instead of in the root layout. */
export function CrashReportingHost(): null {
  useCrashReporting();
  return null;
}
