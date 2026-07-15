/** Headless, app-wide engine host. Mounted ONCE at the app root (`src/app/_layout.tsx`), it is the
 *  single owner of the cross-cutting engines that used to live in screen hooks — so they run whether
 *  or not their screen is on top:
 *
 *   - the one live-data poll loop (period-not-gap timing, error-dedup logging),
 *   - alert evaluation + OS notifications on new warn/critical, with default-rule seeding,
 *   - diagnostic/connection notifications fed by REAL state (milOn/dtcCount from the fault-codes
 *     store, plus connect/disconnect transitions), and the setNotifPrefs sync,
 *   - trip sample accumulation while recording.
 *
 *  It renders nothing. Being the composition host, it is the one place allowed to read several
 *  features' stores at once (the same cross-store pattern the old per-screen hooks already used);
 *  every screen still talks only to shared stores. See docs/features/*.md.
 */

import { useEffect, useRef } from 'react';
import {
  AlertEngine,
  defaultRules,
  deriveDiagnosticEvents,
  diffReadiness,
  DiagSnapshot,
  LiveValue,
} from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { logError } from '@/shared/state/errorLogStore';
import { notify, setNotifPrefs } from '@/shared/notify';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useLiveDataStore } from '@/features/live-data/model/liveDataStore';
import { useAlertsStore } from '@/features/alerts/model/alertsStore';
import { useNotificationsStore } from '@/features/notifications/model/notificationsStore';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useDtcStore } from '@/features/fault-codes/model/dtcStore';
import { useCoachStore } from '@/features/fault-codes/model/coachStore';
import { computePollPids, enabledRulePids } from './pollPids';

// Dedupe repeated poll-loop errors so a persistent fault doesn't flood the capped error log.
let lastPollErrorMsg: string | null = null;

// Readiness/drive-cycle coach poll cadence — light (readiness barely changes minute-to-minute).
const COACH_POLL_MS = 30_000;

/** Evaluate the current rules against one snapshot; fire OS notifications on new warn/critical. */
function evaluateAlerts(engine: AlertEngine, snap: Record<string, LiveValue>): void {
  try {
    const store = useAlertsStore.getState();
    const { active, fired } = engine.evaluate(store.rules, snap);
    store.setActive(active);
    for (const a of fired) {
      if (a.severity !== 'info')
        void notify({
          category: 'alert',
          severity: a.severity,
          title: a.rule.label ?? a.pid,
          body: `${a.pid} = ${a.value}`,
        });
    }
  } catch (e) {
    logError({ source: 'alerts', error: e, severity: 'warning' });
  }
}

/** The single, app-wide engine host. Returns null — it only runs effects. */
export function EngineHost(): null {
  const session = useSessionStore((s) => s.session);
  const status = useSessionStore((s) => s.status);
  const info = useSessionStore((s) => s.info);
  const intervalMs = useSettingsStore((s) => s.pollIntervalMs);

  // Seed sensible default alert rules once the effective PID set is known — regardless of whether
  // the Alerts screen was ever opened.
  const rules = useAlertsStore((s) => s.rules);
  const setRules = useAlertsStore((s) => s.setRules);
  useEffect(() => {
    if (rules.length === 0 && info?.supportedPids?.length) setRules(defaultRules(info.supportedPids));
  }, [info, rules.length, setRules]);

  // Keep the shared notifier in sync with the user's prefs at startup and on every change.
  const prefs = useNotificationsStore((s) => s.prefs);
  useEffect(() => {
    setNotifPrefs(prefs);
  }, [prefs]);

  // Diagnostic/connection notifications on rising edges, fed by REAL diagnostic state: the MIL flag
  // and stored-DTC count come from the latest fault-codes read (previously hardcoded false/0, which
  // made the MIL / new-code events dead code).
  const storedCount = useDtcStore((s) => s.stored.length);
  const milOn = useDtcStore((s) => s.readiness?.milOn ?? false);
  const prevSnapRef = useRef<DiagSnapshot | null>(null);
  useEffect(() => {
    try {
      const cur: DiagSnapshot = {
        status: status === 'initializing' ? 'connecting' : status,
        milOn,
        dtcCount: storedCount,
      };
      const events = deriveDiagnosticEvents(prevSnapRef.current, cur);
      prevSnapRef.current = cur;
      for (const e of events) void notify(e);
    } catch (e) {
      logError({ source: 'notifications', error: e, severity: 'warning' });
    }
  }, [status, milOn, storedCount]);

  // The single poll loop. Demand-driven: it reads the union of mounted-screen PID interest, the PIDs
  // enabled alert rules reference, and (while recording) the trip PID set. Empty union + not
  // recording ⇒ it idles with no bus traffic.
  const alertEngineRef = useRef(new AlertEngine());
  useEffect(() => {
    if (!session) return;
    const engine = alertEngineRef.current;
    engine.reset();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    lastPollErrorMsg = null;

    const loop = async () => {
      if (cancelled) return;
      const recording = useTripStore.getState().recording;
      const profile = getVehicleProfile(useVehicleStore.getState().selectedProfileId);
      const effective = session.effectivePids(profile.id === 'generic' ? undefined : profile.supportedPids);
      const pids = computePollPids({
        registrations: useLiveDataStore.getState().registrations,
        alertPids: enabledRulePids(useAlertsStore.getState().rules),
        tripPids: recording ? effective : [],
      });

      // Nothing demanded and not recording → idle this sweep, re-check next tick.
      if (pids.length === 0) {
        useLiveDataStore.getState().setPolling(false);
        if (!cancelled) timer = setTimeout(loop, intervalMs);
        return;
      }
      useLiveDataStore.getState().setPolling(true);

      // Treat intervalMs as the target *period*, not an extra gap after each sweep: subtract the time
      // the sweep itself took so updates arrive as close to real time as the link allows. On a slow
      // K-line car a full sweep may already exceed the interval, so the next one fires immediately
      // (gap 0) and the bus paces us.
      const startedAt = Date.now();
      try {
        const snap = await session.pollOnce(pids);
        if (!cancelled) {
          useLiveDataStore.getState().setValues(snap);
          evaluateAlerts(engine, snap);
          if (useTripStore.getState().recording) {
            const numeric: Record<string, number | null> = {};
            for (const [pid, v] of Object.entries(snap)) numeric[pid] = v?.value ?? null;
            useTripStore.getState().pushSample({ t: Date.now(), values: numeric });
          }
        }
        lastPollErrorMsg = null;
      } catch (e) {
        // Transient read errors keep the loop going, but log the first of each distinct kind so a
        // persistent polling fault is visible in the error log without flooding it every interval.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== lastPollErrorMsg) {
          lastPollErrorMsg = msg;
          logError({ source: 'live-data', error: e, severity: 'warning' });
        }
      }
      if (!cancelled) {
        const elapsed = Date.now() - startedAt;
        timer = setTimeout(loop, Math.max(0, intervalMs - elapsed));
      }
    };
    loop();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      useLiveDataStore.getState().setPolling(false);
    };
  }, [session, intervalMs]);

  // --- Readiness / drive-cycle coach (6b.9) --------------------------------------------------------
  // Isolated from the poll loop above. When the user enables the coach from the Faults screen AND we
  // are connected, poll readiness (0101) every ~30 s, keep coachStore fresh for the live panel, and
  // fire a diagnostic notification the moment a monitor flips ready (and once when ALL are ready).
  // Notifications go through notify() so they respect the user's prefs + quiet hours. The watcher
  // ends on toggle-off or disconnect (effect cleanup + the reset effect below).
  const coachEnabled = useCoachStore((s) => s.enabled);
  useEffect(() => {
    if (!session || !coachEnabled || status !== 'connected') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let prev = useCoachStore.getState().readiness;

    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await session.readReadiness();
        if (r && !cancelled) {
          const diff = diffReadiness(prev, r);
          useCoachStore.getState().setReadiness(r);
          for (const m of diff.becameReady)
            void notify({
              category: 'diagnostic',
              severity: 'info',
              title: 'Monitor ready',
              body: `${m.name} monitor complete`,
            });
          if (diff.becameAllReady)
            void notify({
              category: 'diagnostic',
              severity: 'info',
              title: 'Readiness complete',
              body: 'All monitors are ready — the car is set for an emissions test.',
            });
          prev = r;
        }
      } catch (e) {
        logError({ source: 'readiness-coach', error: e, severity: 'warning' });
      }
      if (!cancelled) timer = setTimeout(tick, COACH_POLL_MS);
    };
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, coachEnabled, status]);

  // End coach mode on disconnect so it doesn't silently resume on the next connection.
  useEffect(() => {
    if (status !== 'connected' && useCoachStore.getState().enabled) useCoachStore.getState().reset();
  }, [status]);

  return null;
}
