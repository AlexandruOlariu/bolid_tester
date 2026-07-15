# App review & improvement plan — 2026-07-12

> **Status (2026-07-15): implemented.** Phases 1–5 ✅ · Phase 6 ✅ (6.9 Web-BT PWA deferred) ·
> Phase 6b ✅ (all ten). Suite 309 → 504 tests; typecheck/typecheck:app/lint green. See
> [`implementation-log.md`](./implementation-log.md) for the landing summary.

Code review of the app layer (`src/app`, `src/features`, `src/shared`), excluding tests per
request. Complements — does not duplicate — the open items in
[`vcds-parity-roadmap.md`](./vcds-parity-roadmap.md) (KWP login UI, label packs, on-car
validation), which remain tracked there.

**Overall state:** the codebase is in very good shape. Clean layering (`transport → elm327 →
obd → session`), a hardened response parser (ISO-TP reassembly, notice classification), careful
addressing hygiene (`resetAddressing()` in `finally`), a well-designed error log with dedup and
crash capture, and no TODO/`any`/console debt anywhere. The findings below are the gaps a fresh
pass still finds — most are about **lifecycle and wiring**, not the OBD engine itself.

---

## Findings (verified against code)

### F1 — Cross-cutting engines only run while their screen is mounted · **High**

Alerts, notifications, and trip sampling are hosted in screen-level hooks:

| Engine | Hook | Only mounted in |
|---|---|---|
| Threshold alerts + OS alert notifications | `useAlerts` | `alerts/ui/AlertsScreen.tsx` |
| Connection/diagnostic notifications + prefs sync (`setNotifPrefs`) | `useNotifications` | `notifications/ui/NotificationsScreen.tsx` |
| Trip sample accumulation | `useTripRecorder` | `trip-recording/ui/TripScreen.tsx` |
| Live polling (feeds all of the above) | `useLiveData` | `DashboardScreen`, `SensorReadingsScreen` |

Consequences on a fresh app start:

- Alert rules never evaluate until the user opens the Alerts screen once — "overheat warning
  while driving on the Live tab" silently doesn't fire.
- Connect/disconnect notifications and the user's notification prefs only take effect after
  visiting the Notifications screen.
- A recording trip only collects samples while (a) TripScreen has been mounted and (b) some
  screen is running `useLiveData` — the coupling is invisible to the user.
- `useLiveData` in two mounted screens (tab screens stay mounted once visited) runs **two
  concurrent poll loops** over the full PID set. The ELM queue serializes them, so nothing
  corrupts, but effective refresh rate halves and bus traffic doubles.

Additionally `useNotifications` builds its `DiagSnapshot` with hardcoded `milOn: false,
dtcCount: 0` — the MIL-on / DTC-count events that `deriveDiagnosticEvents` supports can never
fire (dead code path).

### F2 — BLE link loss is never propagated to the app · **High**

`BleTransport` registers `device.onDisconnected(...)` but only mutates its own `status` field
(`BleTransport.ts:45`). Nothing observes it: `sessionStore` stays `'connected'`, every screen
keeps rendering as connected, and each subsequent command dies as a 4–12 s timeout. The
`Transport` interface has no status-change event, and there is no auto-reconnect anywhere
(verified by grep). Pulling the adapter mid-session = an app that looks healthy but times out
forever until the user manually disconnects/reconnects.

### F3 — Failed connect leaks the BLE connection · **Medium-high**

`connectionService.connect()` catch block sets store status + logs, but never tears down the
transport (`connectionService.ts:75-81`). The designed failure path — probe fails because the
ignition is off — throws *after* the GATT link is up, the notify monitor is subscribed, and the
client is attached. The session was never stored, so `disconnect()` can't reach it. Retrying
creates a second `BleTransport` to the same device while the first GATT link + monitor leak.

### F4 — Multi-ECU responses are concatenated into garbage · **Medium (real-hardware correctness)**

With headers off, a functional-addressed request on a car where several ECUs answer (Mode 03,
`0100` on engine+TCU petrol cars — the Punto profile is exactly this class) returns **one line
per ECU**. `parseElmResponse` → `normalize()` collapses newlines and hex-parses the whole blob;
`readDtcs()` strips only the *first* `43` service byte (`DiagnosticSession.ts:186-192`). The
second ECU's `43` lands inside the DTC byte stream → phantom/garbled codes. Same class of bug as
the sim-fidelity gaps fixed 2026-07-03; the simulator currently only ever answers as one ECU, so
tests can't catch it.

### F5 — Adapter I/O log churns state per BLE chunk · **Medium (perf)**

`withLog` appends a log entry per **rx chunk** (BLE notification fragment, not per line) via
`settingsStore.appendLog`, which copies a ≤300-entry array each call
(`connectionService.ts:30-34`, `settingsStore.ts:78`). During normal polling that's fine; during
sniffing (`ATMA` on a busy bus) it's hundreds of zustand sets + array copies per second on the JS
thread, re-rendering any subscribed screen. The sniffer already has its own line listener — the
I/O log double-handles the same firehose.

### F6 — Trips: in-memory list, orphaned CSVs · **Medium**

`tripStore` keeps `trips` in memory only — the list is gone on restart — while `stopRecording()`
writes `trip-<id>.csv` to `documentDirectory` (`useTripRecorder.ts:40-46`). `removeTrip` deletes
the store entry but never the CSV. Net effect: the app's trip list is ephemeral, yet the files
accumulate forever with no way to list, share, or delete them.

### F7 — History: unbounded growth, full-file rewrite per entry · **Medium**

`historyStore` has unlimited retention (documented as intentional) but each AI entry embeds the
**full `AiReport`**, and zustand-persist rewrites the entire JSON file on every add/remove.
Hundreds of entries → multi-hundred-KB `JSON.stringify` on the JS thread per save, plus slow
hydration at launch. Same write-amplification applies to the error log (capped at 500, so bounded
— but the cap is the only thing bounding it).

### F8 — AI `apiKey` persisted in plaintext · **Low-medium (security)**

`settingsStore.partialize` persists the whole `ai` object including `apiKey` into a plain JSON
file in `documentDirectory` (readable via device backups). Benign for local LM Studio; not for a
real OpenAI-compatible cloud key.

### F9 — No root ErrorBoundary · **Low-medium**

`installGlobalErrorHandlers()` captures uncaught JS errors into the error log, but a React
**render** error still tears down the whole tree with the default crash UX. A root boundary in
`_layout.tsx` that logs to `errorLogStore` and offers "reload" would keep one bad screen from
killing the app.

### F10 — Lint covers only a third of the code · **Low (DX)**

`npm run lint` targets `shared/lib`, `obd-core`, `vehicles` only. `src/features/**`, `src/app/**`
and all `.tsx` are unlinted — no `react-hooks/exhaustive-deps` anywhere (e.g. `useModuleScan`'s
callbacks close over `modules`/`store` with deps `[session, profileId]`; correct today, fragile
tomorrow). No CI script ties `typecheck:app + lint + test` together.

### Hardening note (no action forced)

`Elm327Client.exec()` clears `this.buffer` on entry, so a late reply from a *timed-out* command
can still interleave into the next command's window. Rare in half-duplex practice; if it ever
shows up on-car, the fix is to drain-until-prompt after a timeout before releasing the queue.

---

## Implementation plan

Simulator-first, one PR per item, docs updated alongside (repo convention). Sizes: S ≤ ½ day,
M ≈ 1 day, L ≈ 2–3 days.

### Phase 1 — Connection correctness (F2, F3) · the "pulled the adapter" story

1. **Transport status events (M)** — add `onStatusChange(listener): unsubscribe` to the
   `Transport` interface; implement in `BleTransport` (wire `onDisconnected` → emit) and
   `MockTransport` (add a sim "link drop" control for testing).
2. **Propagate into the session layer (S)** — `connectionService` subscribes on connect:
   status → `sessionStore.setStatus('disconnected')` + error message; detach the client.
   Screens already render from `sessionStore`, so banners come for free.
3. **Teardown on failed connect (S)** — in `connect()`'s catch: `await session.disconnect()`
   (best-effort) before rethrowing, so the GATT link, monitor subscription, and client listener
   never leak. Cover with the existing "probe fails" path in the sim.
4. **Optional auto-reconnect (M)** — one retry pass with backoff (e.g. 2 s/5 s/10 s) behind a
   settings toggle, reusing the stored `deviceId`. Abort on manual disconnect.

**Acceptance:** kill the sim link (or walk away from the adapter) mid-poll → UI flips to
disconnected within a second, one actionable error entry, no timeout cascade; failed ignition-off
connect then successful retry works without app restart.

### Phase 2 — Engine host: make cross-cutting features actually cross-cutting (F1)

1. **`EngineHost` headless component (L)** — mounted once in `_layout.tsx`. Owns:
   - the single poll loop (move the loop out of `useLiveData`; the hook becomes a store
     subscription only),
   - alert evaluation (`AlertEngine`) fed by every snapshot,
   - notification edge-detection fed by *real* state — `milOn`/`dtcCount` from the latest
     fault-code read (`dtcStore`) instead of the hardcoded `false/0`,
   - trip sample accumulation while `tripStore.recording`,
   - `setNotifPrefs` sync at startup.
2. **Demand-driven PID set (M)** — poll the union of: PIDs mounted screens request (small
   registration API on `liveDataStore`), PIDs referenced by enabled alert rules, and (while
   recording) the trip PID set. No subscriber + not recording → loop idles.
3. **Delete the per-screen loops (S)** — `DashboardScreen`/`SensorReadingsScreen` keep calling
   `useLiveData()` but it no longer spawns a loop; double-polling disappears by construction.

**Acceptance:** fresh start → connect → stay on the Live tab: an injected overheat fires an OS
notification without Alerts ever being opened; a trip records fully with TripScreen never
mounted after pressing start; exactly one poll sweep per interval regardless of mounted screens.

### Phase 3 — Real-hardware parsing: multi-ECU (F4)

1. **Line-aware parse path (M)** — in `responseParser`, when the raw response contains multiple
   plain hex lines (and no ISO-TP segments), return per-line byte groups (`ParsedResponse.frames:
   number[][]`, `bytes` staying the first/concatenated for back-compat).
2. **Consume in `readDtcs` (S)** — strip the service byte and parse DTCs **per frame**, then
   merge + dedupe. Same treatment for `discoverSupportedPids` (first valid frame wins / OR the
   bitmaps).
3. **Sim scenario (S)** — add a multi-ECU scenario (engine + TCU answering `0100` and Mode 03 on
   separate lines, real-adapter format) so the regression is pinned. Extend the Punto profile to
   use it.

**Acceptance:** sim multi-ECU scenario returns exactly the injected DTC set — no phantom codes;
single-ECU cars unchanged.

### Phase 4 — Data lifecycle & perf (F5, F6, F7)

1. **I/O log decoupling (M)** — make the adapter log a module-level ring buffer with a throttled
   (e.g. 4 Hz) store publish, and pause `withLog` rx-mirroring while `client.monitoring` (the
   sniffer already has the data). Kills the per-chunk array copies.
2. **Trips persistence + file lifecycle (M)** — persist trip *headers* (not samples) via
   `persistStorage`; lazy-load samples from CSV on open; `removeTrip` deletes the CSV
   (`deleteAsync`, idempotent); add share/export via `expo-sharing` like the DTC report.
3. **History bounds (S)** — cap entries (e.g. 200, oldest evicted — mirror `MAX_ERRORS`
   pattern) or strip the embedded `AiReport` down to what the detail view renders; debounce
   persist writes (e.g. 500 ms) in a small wrapper around `fileStateStorage.setItem`.

**Acceptance:** sniffing a busy sim bus keeps the UI responsive; trips survive restart and
deleting one removes its CSV; a 500-entry history no longer rewrites hundreds of KB per save.

### Phase 5 — Polish & DX (F8, F9, F10)

1. **Secure the API key (S)** — store `ai.apiKey` in `expo-secure-store`; exclude it from
   `partialize`; hydrate on startup; one-time migration that moves any persisted plaintext key
   and rewrites the settings file.
2. **Root ErrorBoundary (S)** — class component in `_layout.tsx`: logs via `logError({source:
   'render'})`, renders a minimal "something broke — reload" screen.
3. **Lint everything (S)** — extend eslint to `src/**/*.{ts,tsx}` with `react` +
   `react-hooks` plugins; fix fallout; add `"ci": "npm run typecheck:app && npm run lint && npm
   test"`.
4. **(From roadmap, unchanged)** — KWP login UI, additional label packs, on-car validation
   checklists stay tracked in `vcds-parity-roadmap.md`.

### Phase 6 — Nice-to-haves (opportunistic, no dependency on Phases 1–5)

Ideas spotted during review, none blocking. Ordered by value-for-effort.

1. **Fuel economy from live data (M)** — compute instantaneous + trip L/100km from MAF/speed
   (or fuel-rate PID `015E` when supported); show on the dashboard and in trip stats. Diesel vs
   petrol handled per profile `fuel`. High perceived value for near-zero new plumbing — it's
   pure `analysis/` math over PIDs already polled.
2. **GPS track on trips (M)** — `expo-location` is already a dependency but unused by trip
   recording. Record a coarse GPS track alongside samples, show distance + a simple polyline on
   the trip detail, and compare GPS speed vs OBD speed (a classic odometer/clone sanity check).
3. **Units toggle (S)** — `settingsStore.units` is hardcoded `'metric'`. Add imperial: one
   conversion layer at display time (`shared/lib`), never in obd-core (keep decoded SI values
   canonical).
4. **Shareable diagnostic report (M)** — extend the existing `dtcReport` text export to a
   nicely formatted PDF/HTML (vehicle, VIN, readiness, DTCs with VAG numbers, freeze frames,
   AI summary) via `expo-sharing` — the "send to my mechanic" artifact.
5. **Dashboard customization (M)** — let the user pick/reorder gauges and value cards
   (persisted per vehicle profile). The PID registry already carries names/units, so this is
   UI + a small persisted layout model.
6. **Adapter health check (S)** — a one-tap screen that runs `ATI`/`ATRV`/`ATDPN` + a timed
   `0100` burst and grades the adapter (firmware string, voltage, latency, clone quirks
   detected). Turns "is my clone junk?" support questions into a screenshot.
7. **Chart interactions (M)** — pinch-to-zoom/pan on live charts, tap-to-inspect a sample,
   and PNG export of the current window for sharing.
8. **Onboarding pass (S)** — first-run hints: pick vehicle → connect → what the simulator is;
   plus accessibility labels on `Gauge`/`ValueCard` (currently visual-only).
9. **Web Bluetooth PWA transport (L)** — the `Transport` docstring already promises it; a
   `WebBluetoothTransport` + Expo web target would make the whole app demoable in Chrome
   desktop/Android with zero native install. Good showcase, real effort.
10. **EAS Update / OTA (S)** — wire `expo-updates` so JS-only fixes (all of Phases 2–5) ship
    without rebuilding the APK.

### Phase 6b — VCDS parity, next tier

Builds on what the parity pass shipped (module scan, TP2.0, adaptations, routines, label packs).
The still-open roadmap items (KWP login UI, more label packs, on-car validation) stay in
[`vcds-parity-roadmap.md`](./vcds-parity-roadmap.md); these are the *new* parity ideas on top.

1. **VCDS-style Auto-Scan text report (S)** — render a module scan as the classic
   forum-pasteable text block (chassis, per-module address/name/part no/coding/faults with
   VAG numbers), exportable via `expo-sharing`. Every VW forum reads this format on sight —
   instant credibility, and it's pure formatting over `moduleScanStore` data.
2. **Scan diff / before-after (M)** — persist auto-scans (history-store pattern) and diff two:
   faults appeared/cleared, coding changed, part numbers swapped. The killer view for
   "did the repair work?" and for the used-car inspection (compare against a healthy baseline).
3. **Search all modules for a DTC (S)** — one query across the last scan's per-module faults +
   engine OBD2 codes; VCDS users expect it when chasing a symptom across gateway/ABS/cluster.
4. **Long-coding helper (M)** — VCDS's most-loved screen: per-bit/byte tooltips from label
   packs over the existing `coding.ts` bit/byte schema, with live preview of what each toggle
   means and the backup/diff/restore flow already built.
5. **One-tap coding presets ("tweaks") (M)** — OBDeleven-style curated toggles per profile
   (comfort blink count, needle sweep, DRL) compiled down to the existing gated coding writes.
   Data effort per car, engine already there; ships with 2–3 tweaks for the Golf Plus as proof.
6. **Measuring-block logging (M)** — VCDS's "Log" button: record grouped module DIDs
   (`extended-pids` / label-pack groups) to CSV over time, not just OBD2 PIDs — reuses the trip
   CSV path; feeds charts so Mode 22 values plot like any PID.
7. **Guided fault finding (M)** — from a DTC, deep-link to its related measuring blocks, freeze
   frame, and the relevant routine (e.g. P0401 → EGR DIDs + EGR learn routine), driven by a
   small per-profile mapping table; the AI report can cite the same links.
8. **Full coding backup ("clone my car") (M)** — one tap reads every module's coding +
   adaptation channels into a dated JSON snapshot; restore is per-module behind the existing
   coding gates. The safety net VCDS users keep in a drawer.
9. **Drive-cycle / readiness coach (M)** — after a code clear, show which monitors are still
   `not ready` (already decoded) plus the per-monitor drive pattern to complete them; notify as
   each flips ready during a live session. Pairs with the inspection feature before an ITP.
10. **Bus wake / tester-present broadcast (S)** — a "wake sleeping bus" action (functional
    tester-present burst) before module scans, addressing the probe-fails-on-parked-car case the
    TP2.0 error message already hints at.

### Suggested order & rough total

Phase 1 → 2 are the user-visible reliability jump (~4–5 days). Phase 3 before the next real-car
session (~1 day). Phases 4–5 as filler between on-car validations (~3 days). Each phase is
independently shippable. Phase 6 items are à la carte — fuel economy (6.1) and the units toggle
(6.3) are the best first picks. In 6b, the Auto-Scan text report (6b.1) and scan diff (6b.2) give
the biggest "feels like VCDS" jump for the least engine work.

### Follow-through (repo conventions)

- Update `docs/features/*` for connection (status events), alerts/notifications/trip-recording
  (EngineHost hosting), sniffer (log pause).
- Add `concept:engine-host` to `graph/curated.json` once Phase 2 lands.
- Append each landed phase to `docs/implementation-log.md`.
