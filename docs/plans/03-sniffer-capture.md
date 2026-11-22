# Plan 03 — Bus sniffer: save and share captures

**Size:** S–M (½–1 day) · **Depends on:** nothing · **Roadmap:** v0.2 "Sniffer captures"

## Goal

A sniffer run can be **saved and shared** as a timestamped CSV (and the raw adapter lines), with a
note, so a VCDS session performed in parallel can be recorded and its real routine bytes recovered
later. This is the unlock for everything in roadmap v0.6.

Everything below is built and tested against the simulator; the VCDS recording itself is a later
owner session (last section).

## Why

`src/features/can-sniffer` aggregates frames per CAN id for display but discards the stream. The
memory note in `docs/features/routines.md` ("Confirming a routine on the real car") says the only
way to learn the V157 Group 121 bytes is to sniff while VCDS runs — and today nothing can be kept.

## Read first

- `src/features/can-sniffer/{hooks/useSniffer.ts, model/snifferStore.ts, ui/SnifferScreen.tsx}`.
- `src/shared/obd-core/obd/canMonitor.ts` (`MonitorFrame`, `parseMonitorLine`, `FrameStat`,
  `CanFrameAggregator`) and `canMonitor.test.ts`.
- `src/shared/obd-core/session/DiagnosticSession.ts` `startSniffer(onLine)` / `stopSniffer()` /
  `sniffing`; `Elm327Client.startMonitor` for how lines arrive.
- `src/shared/obd-core/transport/MockTransport.ts` `monitorFrames` and
  `src/shared/obd-core/session/sniffer.integration.test.ts`.
- `src/features/error-log/hooks/useErrorLogExport.ts` — the export pattern to copy.
- `docs/adapter-vgate-icar-pro.md` (ATMA notes), `docs/features/routines.md` § "Confirming a routine".

## Design

### Core (pure, `src/shared/obd-core/obd/`)

New `captureBuffer.ts`:

```ts
export interface CapturedLine {
  t: number;
  raw: string;
  frame: MonitorFrame | null;
}
export class CaptureBuffer {
  constructor(public readonly capacity = 20_000) {}
  push(raw: string, t: number): void; // parses with parseMonitorLine; drops oldest past capacity
  get size(): number;
  get dropped(): number; // lines evicted
  lines(): CapturedLine[]; // chronological copy
  clear(): void;
}
```

In `canMonitor.ts` add:

```ts
export interface CaptureHeader {
  vehicleId: string;
  protocol?: string;
  adapter?: string;
  startedAt: number;
  note?: string;
  appVersion?: string;
}
/** CSV: header comment lines (# key: value) then `t_ms,id,dlc,bytes` (bytes space-separated upper hex). Unparsed lines go to a trailing `# raw:` block. */
export function formatCaptureCsv(header: CaptureHeader, lines: CapturedLine[]): string;
/** Raw dump: one adapter line per row, exactly as printed, prefixed by `t_ms\t`. */
export function formatCaptureRaw(header: CaptureHeader, lines: CapturedLine[]): string;
```

`t_ms` is milliseconds since `startedAt` (relative, so files diff well).

### Feature

- `snifferStore.ts`: add `capturedLines: number`, `dropped: number`, `note: string`, `setNote`,
  `setCapture(count, dropped)`, `lastExportUri: string | null`.
- `useSniffer.ts`: own a `CaptureBuffer` in a `useRef`; in `start()` clear it; in the `onLine`
  callback `buffer.push(line, Date.now())` (keep the aggregator); in the 500 ms snapshot also
  `store.setCapture(buffer.size, buffer.dropped)`. Expose `exportCsv()` / `exportRaw()` that build the
  header from `useSessionStore.getState().info` (protocol, version) and the selected profile id, and
  delegate to the new export hook. Guard: refuse to export while `running`.
- New `hooks/useSnifferExport.ts` — copy of `useErrorLogExport` writing
  `bolid-sniff-<vehicleId>-<stamp>.csv` (`text/csv`) or `.txt` (`text/plain`) and sharing it.
- `SnifferScreen.tsx`: a `note` `Input` ("What is happening? e.g. VCDS Group 121 basic settings, engine idle")
  above Start; while running show `captured N · dropped M`; after Stop show **Share CSV** and **Share
  raw** buttons and a one-line explanation. Keep the existing per-id table.

### Documentation of the capture technique

In the new `docs/features/can-sniffer.md` include a "Record a VCDS session" guide:

1. Hardware: an **OBD2 1-to-2 Y-splitter** so the VCDS interface (HEX-V2 / cable) and the Vgate
   share the port. Both are passive on the bus except when transmitting; the ELM in `ATMA` never
   transmits.
2. Phone: Settings → Real adapter → Connect; More → Bus sniffer → type the note → **Start**.
3. Laptop: run the VCDS function (e.g. 01-Engine → Basic Settings → Group 121 → ON/OFF), wait for it
   to finish, then **Stop** on the phone and **Share CSV**.
4. Analysis (later, roadmap v0.6): look for the tester → ECU request ids (`7E0` engine on the Golf,
   or TP2.0 channel setup on `200`/`2xx`) and the payloads around the VCDS action time; the
   `t_ms` column aligns with the laptop clock note.
5. Limits: on K-line (Passat) `ATMA` shows only what the ELM can see on the K-line it is attached to;
   expect little.

## Steps

1. `captureBuffer.ts` + `captureBuffer.test.ts`; `formatCaptureCsv` / `formatCaptureRaw` +
   tests in `canMonitor.test.ts`. Export both from `src/shared/obd-core/index.ts`.
2. Store fields; `useSniffer` buffer + export; `useSnifferExport.ts`.
3. `SnifferScreen.tsx` UI.
4. `docs/features/can-sniffer.md` (new, full spec with the guide); link it from `docs/features/tp20.md`
   § "Honest limits" and `docs/features/routines.md` § "Confirming a routine".
5. `npm run format`, `npm run ci`.

## Simulator

`MockTransport` already streams `monitorFrames` for `ATMA`. Add a Golf scenario default of ~30
frames across 4 ids if the current default is smaller, so the CSV in the simulator has real content.
Extend `sniffer.integration.test.ts`: start → 20 lines → stop → `formatCaptureCsv` has 20 data rows
and the header lines.

## Tests

- `captureBuffer.test.ts`: capacity eviction (push capacity+5 → size == capacity, dropped == 5),
  chronological order, unparsed lines kept with `frame: null`, `clear()`.
- `canMonitor.test.ts`: CSV header lines (`# vehicle:`, `# protocol:`, `# note:`), one row per frame,
  relative `t_ms`, hex formatting, unparsed lines in the `# raw:` block; raw dump has one line per
  input.
- `sniffer.integration.test.ts`: as above.

## Acceptance

- [ ] Simulator: Start → Stop → **Share CSV** opens the share sheet with a file whose first lines are
      the header comments and whose row count equals the captured frame count.
- [ ] Note typed before Start appears in the CSV header.
- [ ] Capturing 25 000 lines keeps the UI responsive and reports `dropped` > 0.
- [ ] Export buttons disabled while running; leaving the screen mid-run still stops `ATMA` (existing
      behaviour preserved).
- [ ] `docs/features/can-sniffer.md` exists with the VCDS guide; `npm run ci` green.

## Deferred until an on-car session

- Record the V157 intake-flap Group 121 basic setting (and a forced DPF regen) with VCDS on the
  laptop and the sniffer on the phone through the OBD2 Y-splitter; note the laptop clock at
  start/stop in the capture note.
- Measure `ATMA` throughput over BLE on the Vgate at idle (frames/s, `dropped` count) and record it in
  `docs/adapter-vgate-icar-pro.md`.
- Passat: confirm how little a K-line `ATMA` shows and document it.
- Feed the captures to plan 25's analyzer and confirmation procedure.
