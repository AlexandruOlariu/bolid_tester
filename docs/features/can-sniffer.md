# Feature: bus sniffer (can-sniffer)

A raw **bus monitor** built on the ELM327 `ATMA` (monitor all) command: every frame the adapter
hears streams in, is grouped per arbitration id for display, and is **kept as a capture** that can
be **saved and shared** as a timestamped CSV or a raw adapter-line dump, with a note. Its main job
is recording what a professional tool (VCDS) sends to the car, so real routine / basic-setting bytes
can be recovered later instead of guessed. Reachable from **More → Bus sniffer** (`/sniffer`).

## Flow

1. Connect (simulator or real adapter). Without a connected session the screen shows
   "Not connected." — unless a finished capture is in memory, which can still be shared (Start
   stays unavailable until you reconnect). Over a link that cannot stream the monitor (Classic
   Bluetooth SPP, plan 27) the screen shows "Bus monitoring is not available over this adapter
   link." with the reason and the advice to sniff with a Bluetooth LE or Wi-Fi adapter
   (`testID="sniffer-unavailable"`) instead of **Start** — see
   [Link capability](#link-capability-plan-27).
2. Type a **note** — what is happening on the bus ("VCDS Group 121 basic settings, engine idle").
   It is written into the capture header **as it was at Start**. The note is kept between runs
   and is read-only while monitoring.
3. **Start monitoring** — clears the previous capture and freezes the header context (selected
   vehicle id, protocol, adapter version + BLE device name, note), so changing the car,
   reconnecting to another adapter or editing the note before Share cannot rewrite the file. Then
   `DiagnosticSession.startSniffer(onLine)`: `ATH1` (headers on) then
   `ATMA`. While monitoring, the adapter channel belongs to the monitor; all other polling pauses
   (the Elm327Client holds its command queue).
4. While running the screen shows `captured N · dropped M` (lines held / oldest lines evicted) and
   the per-id table (count, frames/s, last bytes), refreshed every 500 ms. **Share CSV** and
   **Share raw** are visible but disabled.
5. **Stop** — any byte interrupts `ATMA`; the client waits for the prompt, releases the queue and
   sends `ATH0`. The share buttons enable.
6. **Share CSV** / **Share raw** — writes `bolid-sniff-<vehicleId>-<stamp>.csv` (`text/csv`) or
   `.txt` (`text/plain`) to the app's document directory and opens the OS share sheet. The saved
   file name is shown under the buttons.

Leaving the screen mid-run (or losing the session) still stops `ATMA` and marks the run finished
— also when it happens while Start is still setting `ATMA` up (the monitor is stopped as soon as
the setup returns, and no snapshot timer is left behind). Stop pressed during that setup waits for
it, then stops. The capture stays in memory and can still be shared when the screen is reopened,
until the next **Start** clears it.

## Link capability (plan 27)

`ATMA` streams lines that end in `\r` with no `>` prompt until something interrupts it. A transport
that only hands over prompt-terminated messages cannot carry that: `react-native-bluetooth-classic`
delivers data per delimiter, and the Classic Bluetooth link uses `>` as the delimiter. So
`Transport` has an optional `capabilities?: { monitor: boolean }` (absent = `{ monitor: true }`:
BLE, Wi-Fi TCP, the simulator); `SppTransport` declares `{ monitor: false }`.

- `DiagnosticSession.canMonitor` reads it; `startSniffer()` rejects with
  `MONITOR_UNAVAILABLE_MESSAGE` ("Bus monitoring is not available over this adapter link") before
  sending `ATH1` / `ATMA`, so the command queue is never held. `Elm327Client.startMonitor()` refuses
  the same way (TP2.0's raw-CAN channel uses it directly).
- `useSniffer()` returns `canMonitor` (`session?.canMonitor ?? true`); the screen shows the
  explanation instead of **Start monitoring**. Every other screen works over the same link.
- connectionService's adapter-log wrapper forwards `capabilities`, so the session sees the real
  link's.

## Capture files

Both files start with the same `#` comment header:

```
# bolid-tester bus capture (csv)
# vehicle: golf-plus-2009-20tdi
# protocol: ISO_15765_4_CAN_11_500
# adapter: ELM327 v1.5 (IOS-Vlink)
# started: 2026-11-08T10:00:00.000Z
# note: VCDS Group 121 basic settings, engine idle
# app: 0.1.0
# lines: 1834 (frames 1830, unparsed 4)
# dropped: 0
# t_ms = milliseconds since started
```

- `vehicle` is the selected vehicle profile id; `protocol` and `adapter` come from the session
  (`SessionInfo.protocol`, `SessionInfo.version` plus the BLE device name when known); unknown
  values print as `unknown`. A multi-line note is folded onto one line. A `# app:` line records
  the app version (`APP_VERSION` from `shared/lib/appInfo.ts`, the `app.json` version), right after
  `note`.
- **CSV** — after the header, the column row `t_ms,id,dlc,bytes`, then one row per parsed frame:
  `t_ms` relative to `started` (so files diff well and line up with a laptop-clock note), `id` the
  11-bit (`7E8`) or 29-bit (`18DAF110`) id, or empty when headers were off, `dlc` the number of
  data bytes the adapter printed (with CAN auto-formatting on, this includes the ISO-TP PCI byte),
  and `bytes` space-separated upper-case hex. Lines that are not frames (`BUFFER FULL`,
  `SEARCHING...`, partial lines) go to a trailing block, one `# <t_ms><TAB><line>` per line:
  ```
  # raw: 4 line(s) that did not parse as frames
  # 1520	BUFFER FULL
  ```
- **Raw** — after the header, every adapter line exactly as printed, in arrival order, prefixed by
  `t_ms` and a tab. Use it when the CSV parser may have hidden something.

## Memory bound

The capture is a fixed-capacity ring of **20 000 lines** (`CaptureBuffer`, O(1) per line). Past
that the oldest lines are evicted and counted in `dropped` — shown on screen and written to the
header — so a long sniff never grows without bound and the UI stays responsive. A busy CAN bus at
~1 000 frames/s fills it in about 20 s; for a VCDS action, Start just before and Stop right after.

## model

- `shared/obd-core/obd/canMonitor.ts` (pure, unit-tested) — `parseMonitorLine` / `MonitorFrame`,
  `CanFrameAggregator` / `FrameStat` for the table, and the file formats: `CaptureHeader`,
  `formatCaptureCsv(header, lines)`, `formatCaptureRaw(header, lines)`.
- `shared/obd-core/obd/captureBuffer.ts` (pure) — `CapturedLine { t, raw, frame }` and
  `CaptureBuffer` (`push(raw, t)`, `size`, `dropped`, `lines()`, `clear()`; default capacity
  `DEFAULT_CAPTURE_CAPACITY` = 20 000).
- `features/can-sniffer/model/snifferStore.ts` — zustand (not persisted): `running`, `stats`,
  `totalFrames`, `capturedLines`, `dropped`, `note`, `lastExportUri`; `setCapture`, `setNote`,
  `setLastExportUri`; `reset()` clears a run but keeps the note.
- `features/can-sniffer/model/captureSession.ts` — the module-level current capture
  (`buffer`, `startedAt`, `context` = the `CaptureContext` frozen at Start), so a finished run
  survives the screen being left and reopened.
- `features/can-sniffer/model/snifferController.ts` — `SnifferController` (one per session, no
  React): `start()` / `stop()` / `dispose()`, the 500 ms snapshot, the setup-race handling; and
  `finishedCapture()` → `{ header, lines }` or null while running / when nothing was captured.
- `features/can-sniffer/api/captureExport.ts` — `buildCaptureHeader`, `captureFileName`,
  `buildCaptureFile` (body + MIME per format) and `shareCaptureFile` (write via
  `expo-file-system/legacy`, share via `expo-sharing`, both loaded with variable specifiers;
  failures go to the error log as `can-sniffer/export`).
- `features/can-sniffer/hooks/useSniffer.ts` — thin binding: one controller per session (disposed
  on unmount / session change), `start`, `stop`, `exportCsv()` / `exportRaw()`.
- `features/can-sniffer/hooks/useSnifferExport.ts` — `exportCapture(format, header, lines)` with a
  `busy` flag; records `lastExportUri`.

## Simulator

`MockTransport` answers `ATMA` by streaming the scenario's `monitorFrames` cyclically, one line
every 30 ms, with no prompt until any byte interrupts it. The **Golf** scenario streams 30
illustrative frames across 4 ids — a VW TP2.0 channel setup to the engine (`200` → `201`) and a
tester session on `7E0` → `7E8` (Mode 01 reads, tester-present) — because the PQ35 OBD port sits
behind the gateway, so a real sniff there sees diagnostic traffic rather than the powertrain bus.
Other CAN profiles stream a generic 5-frame mix; K-line profiles a single keep-alive-like line.

## Record a VCDS session

The way to learn bytes that VCDS hides behind its label files (e.g. the V157 intake-flap
**Group 121** basic setting — see
[routines § Confirming a routine](./routines.md#confirming-a-routine-on-the-real-car-the-placeholder-problem)).

1. **Hardware:** an **OBD2 1-to-2 Y-splitter**, so the VCDS interface (HEX-V2 / cable) and the
   Vgate share the port. Both are passive on the bus except when transmitting; the ELM in `ATMA`
   never transmits.
2. **Phone:** Settings → Real adapter → Connect; More → **Bus sniffer** → type the note (include the
   laptop clock time) → **Start**.
3. **Laptop:** run the VCDS function (e.g. 01-Engine → Basic Settings → Group 121 → ON/OFF), wait
   for it to finish, then **Stop** on the phone and **Share CSV** (and **Share raw** if in doubt).
4. **Analysis** (later, roadmap v0.6): look for the tester → ECU request ids (`7E0` engine on the
   Golf, or the TP2.0 channel setup on `200` / `2xx` and the channel ids it negotiates) and the
   payloads around the VCDS action time; the `t_ms` column aligns with the laptop clock noted at
   Start.
5. **Limits:** on K-line (Passat) `ATMA` shows only what the ELM can see on the K-line it is
   attached to; expect little. A cheap clone may print `BUFFER FULL` on a busy bus — those lines
   land in the CSV's `# raw:` block, and frames around them may be missing.

## Acceptance

- Simulator: Start → Stop → **Share CSV** opens the share sheet with a file whose first lines are
  the header comments and whose row count equals the captured frame count.
- A note typed before Start appears in the CSV header.
- Capturing 25 000 lines keeps the UI responsive and reports `dropped` > 0.
- Export buttons disabled while running; leaving the screen mid-run still stops `ATMA`.
- Connected over Classic Bluetooth (SPP), the screen explains that bus monitoring is unavailable
  instead of offering Start, and nothing is sent to the adapter.

## Tests

`obd/captureBuffer.test.ts` (eviction, order, unparsed lines, `clear`, 25 000 lines),
`obd/canMonitor.test.ts` (header lines, one row per frame, relative `t_ms`, hex, `# raw:` block,
raw dump), `session/sniffer.integration.test.ts` (start → 20 lines → stop → 20 CSV rows; Golf
stream shape), `features/can-sniffer/api/captureExport.test.ts` (header, file name / MIME, write +
share, failures logged), `features/can-sniffer/model/snifferStore.test.ts`,
`features/can-sniffer/model/snifferController.test.ts` (Start clears the buffer and freezes the
header context, which also carries the app version; export refused while running / empty; dispose stops `ATMA` and ends the run, also
mid-setup; Stop mid-setup; double Start), `ui/SnifferScreen.test.tsx` (Start over the simulator;
the unavailability notice over a Classic Bluetooth session), the `transport capabilities` cases in
`session/sniffer.integration.test.ts` and `transports/spp/SppTransport.session.integration.test.ts`
(the sniffer refused before anything is sent; the link stays usable).

## Not yet (on-car)

Recording a real VCDS Group 121 / DPF-regen session, measuring `ATMA` throughput over BLE on the
Vgate, and confirming the K-line limits are owner sessions — see
[plan 03](../plans/03-sniffer-capture.md#deferred-until-an-on-car-session).
