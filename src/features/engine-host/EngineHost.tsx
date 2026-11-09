/** Headless, app-wide engine host. Mounted ONCE at the app root (`src/app/_layout.tsx`), it is the
 *  single owner of the cross-cutting engines that used to live in screen hooks — so they run whether
 *  or not their screen is on top:
 *
 *   - the one live-data poll loop (period-not-gap timing, error-dedup logging), reading Mode 01
 *     PIDs and — on CAN, for DIDs the active profile declares — extended `22:<DID>` keys (plan 14),
 *   - alert evaluation + OS notifications on new warn/critical, with default-rule seeding,
 *   - diagnostic/connection notifications fed by REAL state (milOn/dtcCount from the fault-codes
 *     store, plus connect/disconnect transitions), and the setNotifPrefs sync,
 *   - trip sample accumulation while recording,
 *   - the connect-time VIN auto-select of a garage car (plan 06),
 *   - the engine part-number (F187) read whenever a CAN session's active profile declares extended
 *     DIDs and none is cached yet — so switching to the Golf after connecting still resolves its
 *     label pack (plan 14).
 *
 *  It renders nothing. Being the composition host, it is the one place allowed to read several
 *  features' stores at once (the same cross-store pattern the old per-screen hooks already used);
 *  every screen still talks only to shared stores. See docs/features/*.md.
 */

import { useEffect, useRef } from 'react';
import {
  AlertEngine,
  deriveDiagnosticEvents,
  diffReadiness,
  DiagSnapshot,
  LiveValue,
  isCan,
} from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { logError } from '@/shared/state/errorLogStore';
import { notify, setNotifPrefs } from '@/shared/notify';
import { livePidFilter } from '@/shared/vehicles';
import { getActiveProfile, useActiveProfile } from '@/shared/state/activeProfile';
import { autoSelectGarageCarForVin } from '@/features/vehicle-select/api/learnVehicle';
import { useLiveDataStore } from '@/shared/state/liveDataStore';
import { useAlertsStore } from '@/features/alerts/model/alertsStore';
import { useNotificationsStore } from '@/features/notifications/model/notificationsStore';
import { useTripStore } from '@/features/trip-recording/model/tripStore';
import { useDtcStore } from '@/shared/state/dtcStore';
import { useCoachStore } from '@/features/fault-codes/model/coachStore';
import { computePollPids, enabledRulePids, planSweep } from './pollPids';
import { decodeExtendedSnapshot } from './extendedSnapshot';

// Dedupe repeated poll-loop errors so a persistent fault doesn't flood the capped error log. The
// extended (Mode 22) phase keeps its own key so a failing DID never masks a Mode 01 fault.
let lastPollErrorMsg: string | null = null;
let lastExtendedErrorMsg: string | null = null;

/** Log the first of each distinct poll error per phase (see the dedupe note above). */
function logPollError(source: 'live-data' | 'live-data/extended', e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  if (source === 'live-data') {
    if (msg === lastPollErrorMsg) return;
    lastPollErrorMsg = msg;
  } else {
    if (msg === lastExtendedErrorMsg) return;
    lastExtendedErrorMsg = msg;
  }
  logError({ source, error: e, severity: 'warning' });
}

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

  // Offer the starter alert rules once the effective PID set is known — regardless of whether the
  // Alerts screen was ever opened. Each starter rule is offered once (`seededIds`, persisted): a
  // later car adds the ones the first car lacked, and a rule the user deleted is not re-added.
  const seedDefaults = useAlertsStore((s) => s.seedDefaults);
  useEffect(() => {
    if (info?.supportedPids?.length) seedDefaults(info.supportedPids);
  }, [info, seedDefaults]);

  // VIN auto-select (plan 06): every new connection's VIN is checked once against the garage —
  // reconnecting a car you added selects it again (Settings → "Recognise my cars by VIN"). Keyed on
  // the session + VIN, not the info object, so a later info patch (the part number below) never
  // re-runs it and overrides a car the user picked by hand after connecting.
  const vin = info?.vin;
  useEffect(() => {
    if (!session || !vin) return;
    try {
      autoSelectGarageCarForVin(vin);
    } catch (e) {
      logError({ source: 'vehicle-select/auto-select', error: e, severity: 'warning' });
    }
  }, [session, vin]);

  // Engine part number (22 F187), plan 14: it picks the label pack whose measuring groups the
  // Extended PIDs screen shows. Asked for again whenever the active profile changes while none is
  // cached, since the profile at connect time may not have declared DIDs (a Generic pick, then VIN
  // auto-select or a manual switch to the Golf). `session.readPartNumber()` memoises its outcome —
  // a `null` "no answer" included — so `22 F187` still goes on the bus at most once per session;
  // a repeat here after a failed connect-time read costs no request. Only on CAN with a
  // DID-declaring profile; other cars send no Mode 22 at all. The read joins the ELM queue.
  const activeProfile = useActiveProfile();
  const declaresDids = Boolean(activeProfile.extendedPids?.length);
  const canLink = !!info && isCan(info.protocol);
  const hasPartNumber = Boolean(info?.partNumber);
  useEffect(() => {
    if (!session || !canLink || !declaresDids || hasPartNumber) return;
    let cancelled = false;
    void (async () => {
      try {
        const partNumber = await session.readPartNumber();
        if (!cancelled && partNumber) useSessionStore.getState().setPartNumber(session, partNumber);
      } catch (e) {
        logError({ source: 'connection/part-number', error: e, severity: 'warning' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, canLink, declaresDids, hasPartNumber, activeProfile.id]);

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
    lastExtendedErrorMsg = null;

    const loop = async () => {
      if (cancelled) return;
      const recording = useTripStore.getState().recording;
      const profile = getActiveProfile();
      const effective = session.effectivePids(livePidFilter(profile));
      const keys = computePollPids({
        registrations: useLiveDataStore.getState().registrations,
        alertPids: enabledRulePids(useAlertsStore.getState().rules),
        tripPids: recording ? effective : [],
      });
      // Split into Mode 01 PIDs and extended DIDs. DIDs survive only on CAN and when the profile
      // declares them — a stale `22:` chart panel on the Punto / Passat costs no bus traffic.
      const extendedDefs = profile.extendedPids ?? [];
      const { pids, dids } = planSweep(
        keys,
        extendedDefs.map((d) => d.did),
        isCan(session.currentProtocol),
      );

      // Nothing demanded and not recording → idle this sweep, re-check next tick.
      if (pids.length === 0 && dids.length === 0) {
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
      // Mode 01 first, then the extended DIDs on the current (default / engine) header — never
      // re-addressed here. The phases fail independently: a DID read that throws (an ELM timeout, a
      // link hiccup on an unanswered DID) only drops this sweep's extended values, which then simply
      // age out, while the Mode 01 snapshot is still published, alerted on and trip-sampled.
      let snap: Record<string, LiveValue> | null = null;
      try {
        snap = pids.length ? await session.pollOnce(pids) : {};
        lastPollErrorMsg = null;
      } catch (e) {
        // Transient read errors keep the loop going, but log the first of each distinct kind so a
        // persistent polling fault is visible in the error log without flooding it every interval.
        logPollError('live-data', e);
      }
      let ext: Record<string, LiveValue> = {};
      if (dids.length && !cancelled) {
        try {
          const raw = await session.pollExtendedOnce(dids);
          ext = decodeExtendedSnapshot(raw, extendedDefs, Date.now());
          lastExtendedErrorMsg = null;
        } catch (e) {
          logPollError('live-data/extended', e);
        }
      }
      if (!cancelled && (snap || Object.keys(ext).length > 0)) {
        try {
          if (!snap) {
            // Mode 01 failed this sweep: its last values stay as they were (as before plan 14);
            // only the fresh extended values are merged in. No alert / trip pass on stale data.
            // The kept Mode 01 entries carry their old `ts`, so charts skip them (ChartBuffer
            // `pushIfNewer`) instead of logging a duplicate point per stale key.
            const store = useLiveDataStore.getState();
            store.setValues({ ...store.values, ...ext });
          } else {
            const all = { ...snap, ...ext };
            useLiveDataStore.getState().setValues(all);
            evaluateAlerts(engine, all);
          }
          // Trip samples stay Mode 01 only (the trip PID set is the effective Mode 01 set).
          if (snap && useTripStore.getState().recording) {
            const numeric: Record<string, number | null> = {};
            for (const [pid, v] of Object.entries(snap)) numeric[pid] = v?.value ?? null;
            useTripStore.getState().pushSample({ t: Date.now(), values: numeric });
          }
        } catch (e) {
          logPollError('live-data', e);
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
    if (status !== 'connected' && useCoachStore.getState().enabled)
      useCoachStore.getState().reset();
  }, [status]);

  return null;
}
