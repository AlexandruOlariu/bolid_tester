# Plan 25 — Confirmation metadata, module discovery and the capture analyzer

**Size:** L (2–3 days code) · **Depends on:** plan 03 (capture CSV format), plan 02 (fixtures,
"Validated on" table) · **Roadmap:** v0.6 "Confirmed module map", "TP2.0 on hardware",
"Confirmed routines", "Tweaks catalog"

## Goal

Everything the car-side confirmation work needs is built **now**, in the simulator: (1) a
`confirmed` provenance field on every illustrative profile item and UI badges that flip from
"unverified" to "confirmed on <date>"; (2) a **module address discovery** scan that probes the known
VAG UDS header pairs so the real module map is one tap away; (3) a **capture analyzer** (library +
CLI) that turns a sniffer CSV into request/response pairs with ISO-TP reassembly and UDS decoding,
so recovering the real routine bytes from a VCDS session is minutes, not hours; (4) an enforced
rule that `confirmed` always points at a committed fixture or capture. The on-car steps themselves
are written down precisely in the final section.

## Why

Every Tier C address, DID, routine id and tweak bit in `src/shared/vehicles/golf-plus-2009-20tdi.ts`
is marked `experimental: true` with "confirm on the real car" in comments and UI. There is no field
to record _that_ something was confirmed, no tool to find the real addresses, and no tool to read a
capture — so the confirmation loop has nowhere to land.

## Read first

- `src/shared/vehicles/types.ts` — `ExtendedPid.experimental: boolean`, `DiagModule.experimental:
boolean`, `GuidedRoutine` / `AdaptationChannel` / `CodingModule` / `ServiceReset` /
  `ModuleSensor` `experimental: true`; `src/shared/obd-core/coding/presets.ts` `CodingPreset`
  (no experimental field).
- How the badge renders today (all `⚠ … experimental / unverified` strings):
  `ExtendedPidsScreen.tsx` ~136, `ModuleScanScreen.tsx` ~62 and ~169, `RoutinesScreen.tsx` ~25,
  `AdaptationsScreen.tsx` ~38, `CodingTweaks.tsx` ~111, `ServiceResetScreen.tsx` ~75,
  `DpfScreen.tsx` ~37, `SensorTestScreen.tsx` ~51.
- `src/shared/obd-core/obd/canMonitor.ts` (`MonitorFrame`, `parseMonitorLine`) and plan 03's CSV
  (`# key: value` header lines, then `t_ms,id,dlc,bytes` with space-separated upper hex; trailing
  `# raw:` block).
- `src/shared/obd-core/elm327/responseParser.ts` `reassembleIsoTp` (ELM printout reassembly —
  different from raw-frame ISO-TP, which the analyzer must implement itself).
- `src/shared/obd-core/uds/udsModule.ts` (`readModuleIdent`, `MODULE_IDENT_DIDS`),
  `src/features/module-scan/{api/*, hooks/useModuleScan.ts, model/moduleScanStore.ts}`,
  `src/shared/obd-core/tp20/{vagModules.ts, tp20Scan.ts, elmRawCan.ts (probeTp20Capability),
tp20GoldenTrace.test.ts}`.
- `src/shared/vehicles/vehicle-docs-sync.test.ts`; `jest.config.js` (`roots: ['<rootDir>/src']`,
  `testMatch: ['**/*.test.ts']`); Node is v25 locally and 24 in CI — both run `.ts` files directly
  via type stripping, which the CLI relies on.

## Design

### 1. `Confirmation` metadata

```ts
// src/shared/obd-core/confirmation.ts  (exported from obd-core/index.ts; vehicles/types imports it)
export interface Confirmation {
  on: string; // ISO date 'YYYY-MM-DD'
  source: 'sniffer-capture' | 'on-car' | 'vcds-log';
  /** Repo-relative path of the evidence: a plan-02 fixture or a docs/captures/*.csv file. */
  fixture?: string;
  note?: string;
}
```

Add `confirmed?: Confirmation` to `ExtendedPid`, `DiagModule`, `GuidedRoutine`,
`AdaptationChannel`, `CodingModule`, `ServiceReset`, `ModuleSensor`, `LoginCodeEntry` (plan 22)
and `CodingPreset`. `experimental` keeps its meaning (non-standard, per-car data); `confirmed`
records evidence. Pure helper `src/shared/vehicles/confirmation.ts`:

```ts
export type VerificationState = 'standard' | 'confirmed' | 'unverified';
export function verificationState(item: {
  experimental?: boolean;
  confirmed?: Confirmation;
}): VerificationState;
export function verificationText(item): string; // 'Standard OBD2' | 'Confirmed 2026-11-20 (sniffer capture)' | 'Illustrative — not yet confirmed on this car'
```

`standard` when `experimental === false`; `confirmed` when `confirmed` present; else `unverified`.
Shared `src/shared/ui/VerificationBadge.tsx` renders the three states (green / blue / amber) and
replaces every hard-coded warning string listed above. Screen subtitles that currently say
"⚠ Experimental — …" stay as general warnings, but DPF's subtitle becomes "All DIDs confirmed" when
every `category: 'dpf' | 'diesel'` DID is confirmed.

Enforcement in `vehicle-docs-sync.test.ts`: for every `confirmed` across all profile arrays, `on`
matches `/^\d{4}-\d{2}-\d{2}$/` and `fixture`, when set, exists under
`src/shared/obd-core/transport/fixtures/` or `docs/captures/` (new directory, `.gitkeep`).

### 2. Module address discovery (lands now, simulator-tested)

```ts
// src/shared/obd-core/uds/vagHeaders.ts
export interface UdsHeaderCandidate {
  address: string;
  name: string;
  reqHeader: string;
  rxFilter: string;
}
/** Known 11-bit CAN tester/response id pairs for VAG PQ35/PQ46-era UDS modules, by diagnostic address. */
export const VAG_UDS_HEADER_CANDIDATES: UdsHeaderCandidate[]; // 01 7E0/7E8, 02 7E1/7E9, 03 760/768, 08 746/7B0, 09 70E/778, 10 7D0/7DA, 15 715/77F, 16 70C/776, 17 714/77E, 19 710/77A, 25 711/77B, 42 74A/7B4, 44 712/77C, 46 746/7B0 (shared with 08 on some cars — keep both, discovery disambiguates by ident), 52 74C/7B6, 56 70E? (no — radio is TP2.0 on this car; omit), 62 … (fill from the VCDS address list in tp20/vagModules.ts; mark each candidate's source in a comment)
// src/shared/obd-core/uds/discoverModules.ts
export interface DiscoveredModule {
  candidate: UdsHeaderCandidate;
  ident: ModuleIdent | null;
  state: 'answered' | 'silent' | 'error';
  ms: number;
}
export async function discoverUdsModules(
  session: DiagnosticSession,
  candidates: UdsHeaderCandidate[],
  opts?: { timeoutMs?: number; onProgress?: (done: number, total: number) => void },
): Promise<DiscoveredModule[]>;
```

Per candidate: `setHeader(req)`, `setRxFilter(rx)`, `send('22F187')` with the session's command
timeout temporarily lowered (add `DiagnosticSession.withCommandTimeout(ms, fn)` if no such hook
exists — verify `Elm327Client` options first), on answer `readModuleIdent`; always
`resetAddressing()` in `finally`. Module-scan screen gains a **Discover modules** button (CAN only)
whose result rows offer **Add to this car's module list** → for registry profiles it shows the
`DiagModule` literal to paste into the profile (developer flow); for user vehicles (plan 06) it
appends to a new `UserVehicle.modules?: DiagModule[]` that `buildUserProfile` merges in.

Simulator: `MockTransport` already answers `22 F187` only for headers present in `moduleIdent`
(Golf: `7E0`, `760`, `714`) and `NO DATA` elsewhere, so discovery needs no new scenario fields.
Test: on the Golf scenario, discovery returns exactly those three as `answered` with the seeded part
numbers and every other candidate `silent`; `resetAddressing` is called after each candidate
(assert the final `ATSH 7DF` / `ATCRA` via a logging transport).

### 3. Capture analyzer

Library `src/shared/obd-core/analysis/captureAnalyzer.ts` — **self-contained (no imports)** so
Node can execute it directly with type stripping from the CLI, and jest tests it like any core
module:

```ts
export interface CaptureFrame {
  tMs: number;
  id: string;
  dlc: number;
  bytes: number[];
}
export interface CaptureFile {
  header: Record<string, string>;
  frames: CaptureFrame[];
  rawLines: string[];
}
export function parseCaptureCsv(text: string): CaptureFile; // plan-03 CSV; tolerant of CRLF, '# raw:' block
export interface IsoTpMessage {
  id: string;
  tStartMs: number;
  tEndMs: number;
  bytes: number[];
  frames: number;
  flowControlFrom?: string;
  truncated?: boolean;
}
export function reassembleIsoTp(frames: CaptureFrame[]): IsoTpMessage[]; // per id: PCI 0 SF, 1 FF, 2 CF (seq), 3 FC; FCs attached to the opposite stream
export interface UdsDecoded {
  sid: number;
  name: string;
  kind: 'request' | 'positive' | 'negative' | 'unknown';
  sub?: number;
  did?: string;
  routineId?: string;
  nrc?: number;
  nrcName?: string;
  summary: string;
}
export function decodeUds(bytes: number[]): UdsDecoded; // SIDs 10 11 14 18 19 1A 21 22 23 27 2B 2E 2F 30 31 3B 3E and 7F
export interface RequestResponsePair {
  request: IsoTpMessage;
  response: IsoTpMessage | null;
  decodedRequest: UdsDecoded;
  decodedResponse: UdsDecoded | null;
  latencyMs: number | null;
}
export function pairRequests(
  messages: IsoTpMessage[],
  opts?: { windowMs?: number },
): RequestResponsePair[]; // response = next message from a different id whose SID == req SID + 0x40, or 7F <req SID>, within windowMs (default 2000)
export interface Tp20Summary {
  setupRequests: { tMs: number; id: string; target: number; bytes: number[] }[];
  setupResponses: { tMs: number; id: string; bytes: number[] }[];
  dataChannels: { id: string; frames: number; keepAlives: number }[];
}
export function summarizeTp20(frames: CaptureFrame[]): Tp20Summary; // 0x200 setup, 0x201–0x2FF responses, 0x300–0x3FF + 0x740-ish data channels, 0xA3 keep-alive count
export interface CaptureReport {
  header;
  durationMs;
  frameCount;
  ids: { id: string; frames: number; firstMs: number; lastMs: number }[];
  pairs: RequestResponsePair[];
  fingerprints: { key: string; count: number; firstMs: number; lastMs: number; example: string }[];
  tp20: Tp20Summary;
}
export function analyzeCapture(
  file: CaptureFile,
  opts?: { aroundMs?: number; windowMs?: number; onlyId?: string },
): CaptureReport;
export function renderReportMarkdown(report: CaptureReport): string;
```

`fingerprints` groups requests by `SID + sub + DID/RID` (e.g. `31 01 0301`, `2F 0130`, `22 F187`)
with first/last time and count — the single most useful view for "what did VCDS send when I pressed
ON/OFF in Group 121".

CLI `scripts/analyze-capture.mjs`:

```
node scripts/analyze-capture.mjs <capture.csv> [--around <t_ms> --window <ms>] [--id 7E0] [--json]
```

It `import`s `../src/shared/obd-core/analysis/captureAnalyzer.ts` (explicit `.ts` extension; the
module has no imports, so Node's type stripping handles it on Node ≥ 22.18 / 24 / 25), prints the
Markdown report (or JSON with `--json`). Add `"analyze:capture": "node scripts/analyze-capture.mjs"`
to `package.json` and a `verify` CI step that runs it on the synthetic fixture
`docs/captures/synthetic-golf.csv` (committed, generated by the test) so the CLI path is exercised.

### 4. Tweaks catalog groundwork

`CodingPreset.confirmed` from §1 plus a `CodingTweaks.tsx` row badge; and a pure
`compareCodingSnapshots(before: number[], after: number[], presets: CodingPreset[]):
{ presetId: string; matches: 'on' | 'off' | 'none' }[]` in `obd-core/coding/presets.ts` that tells,
for a pair of BCM coding reads taken around a VCDS toggle, which shipped preset's `edits` explain
the change — the tool for confirming tweak bit positions from the owner's own before/after reads.

## Steps

1. `confirmation.ts` types + `verificationState` + `VerificationBadge`; replace the eight badge
   sites; docs-sync enforcement.
2. `vagHeaders.ts`, `discoverModules.ts` + tests; Module-scan **Discover** UI.
3. `captureAnalyzer.ts` + tests; synthetic capture generator in the test writes
   `docs/captures/synthetic-golf.csv` when `UPDATE_FIXTURES=1`; `scripts/analyze-capture.mjs`;
   CI step; `package.json` script.
4. `compareCodingSnapshots` + test; tweaks badge.
5. Docs; `npm run ci`.

## Tests

- `confirmation.test.ts`: three states; text format.
- `vehicle-docs-sync.test.ts`: a `confirmed` with a missing fixture path fails (prove with a
  temporary edit).
- `discoverModules.test.ts` (Golf scenario): exactly `7E0`, `760`, `714` answered with seeded
  idents; others silent; addressing restored; progress callback called `total` times.
- `captureAnalyzer.test.ts` on a synthetic capture that includes: SF `7E0 02 10 03` / `7E8 02 50 03`;
  a multi-frame `7E8 10 14 62 F1 87 …` + two CFs with `7E0 30 00 00` flow control (ISO-TP FF/CF/FC
  reassembled to 20 bytes, `flowControlFrom === '7E0'`); `7E0 04 31 01 03 01` / `7E8 04 71 01 03 01`
  (fingerprint `31 01 0301`); `7E0 04 31 01 02 01` / `7E8 03 7F 31 33` (negative, `nrcName
securityAccessDenied`); a TP2.0 setup pair copied from `tp20GoldenTrace.test.ts` (`0x200` →
  `0x201`) plus three `A3` keep-alives on the data channel (`summarizeTp20` counts them); CRLF line
  endings; a `# raw:` block with one junk line.
- CLI smoke in CI (step above) asserts the Markdown contains `31 01 0301`.
- `presets.test.ts`: `compareCodingSnapshots` finds the DRL preset for a byte-0-bit-0 change and
  none for an unrelated byte.

## Docs

- New `docs/captures/README.md`: naming (`<vehicle>-<flow>-<date>.csv`), what to commit (CSV only,
  trimmed to the relevant window), how to run the analyzer, how to turn findings into `confirmed`.
- `docs/features/module-scan.md`: Discover modules.
- `docs/features/{extended-pids,routines,adaptations,coding,service-reset,dpf}.md`: the badge
  states.
- `docs/vehicles/README.md`: the `confirmed` field and the evidence rule.

## Acceptance

- [ ] Golf simulator: Module scan → **Discover modules** lists engine, ABS, cluster with part
      numbers; the rest silent; standard reads still work afterwards.
- [ ] `node scripts/analyze-capture.mjs docs/captures/synthetic-golf.csv` prints a report whose
      fingerprints include `31 01 0301` and whose TP2.0 section shows one setup pair and three
      keep-alives.
- [ ] Setting `confirmed` on the Golf engine module's F187 DID with a fixture path that exists
      flips its badge to blue; a bogus path fails the docs-sync test.
- [ ] `npm run ci` green.

## Out of scope

Any on-car action (below); clearing faults over TP2.0; automatic promotion of analyzer findings
into profile code (always a reviewed, hand-made edit).

## Deferred until an on-car session

Each step produces evidence first, then a one-line profile change with `confirmed`, then a row in
`docs/vehicles/golf-plus-2009-20tdi.md` → "Validated on the car" (plan 02 format) and, where a
capture is involved, a trimmed CSV under `docs/captures/`.

1. **Module map (Golf, engine running, parked).** More → Module scan → **Discover modules**. Export
   the adapter log as fixture `golf-plus-2009-20tdi/discover.json` (plan 02). For every answered
   candidate, set the profile `modules[]` entry's `reqHeader`/`rxFilter`, `experimental: false` only
   for the standard engine pair, and `confirmed: { on, source: 'on-car', fixture }`. Remove
   candidates that stayed silent across two runs. Compare the part numbers with the VCDS auto-scan
   in the vehicle doc.
2. **Intake flap V157 (Group 121).** OBD2 Y-splitter; phone sniffer note "VCDS Group 121 basic
   settings ON then OFF, engine idle"; Start; on the laptop run VCDS 01-Engine → Basic Settings →
   Group 121 → ON, wait for the deviation to settle, → OFF; Stop; Share CSV. Run the analyzer
   around the ON timestamp (`--around`). Expected outcomes: (a) `7E0`/`7E8` UDS traffic with a
   `31 01 xxxx` fingerprint → set the routine's `id`, keep `service: '31'`, remove
   `unavailableReason`, add `confirmed` with the capture path; (b) only `0x200`/TP2.0 traffic → the
   routine is KWP over TP2.0: record the channel setup and the KWP payload (`31 xx` or
   measuring-block reads) in the doc and leave `unavailableReason` until plan 22's deferred TP2.0
   path lands; (c) a `7F 31 33` → the ECU wants security access first: note the level from the
   preceding `27 xx` and leave it to plan 23.
3. **Forced DPF regeneration.** Same procedure with VCDS's "DPF regeneration while stationary"
   basic setting; outdoors, exhaust extremely hot, do **not** interrupt. Confirm `0201` or replace
   it; confirm the live DIDs (`1702`, `1706`) by matching the `22 xxxx` fingerprints VCDS polls
   during the run.
4. **Extended DIDs.** From the same captures, every `22 17xx` VCDS polls becomes a confirmed
   `ExtendedPid` (scale checked against the VCDS display values noted in the capture note); DIDs
   never seen are removed from the profile.
5. **TP2.0 timing.** With the Golf idling: `probeTp20Capability(client)` → expect `ok`; then
   `scanTp20` three times with `timeoutMs` 300 / 600 / 1000 while the adapter log records; export
   each as a fixture. Note which timeout yields the full install list; set the default in
   `useModuleScan` accordingly and record the adapter firmware string (`ATI`) next to it — this is
   per-adapter data.
6. **Tweaks catalog.** With VCDS: read BCM (`09`) long coding, toggle one feature (e.g. DRL) in
   VCDS, read again; paste both hex strings into a unit test calling `compareCodingSnapshots`;
   adjust the preset's `edits` if the explaining bit differs; set `confirmed: { source: 'vcds-log' }`.
   Only after that may the app apply the tweak on the car (through the existing gated path).
7. **Service reset.** VCDS: 17-Instruments → Adaptation / SRI reset while sniffing; analyzer
   fingerprint on `714`/`77E` (or TP2.0) decides `method` and `routineId`; confirm; then test the app's
   reset once, checking the dash.
