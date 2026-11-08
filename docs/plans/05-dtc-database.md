# Plan 05 — Full DTC database and the DTC detail sheet

**Size:** M–L (1–2 days; the data entry is the bulk) · **Depends on:** nothing · **Roadmap:** v0.3
"Full DTC database", "DTC detail sheet"

## Goal

Every generic SAE J2012 / ISO 15031-6 code the car can report renders a real description, a system
/ subsystem, and a severity hint; manufacturer-specific `P1xxx`/`P3xxx` codes resolve for VAG and
Fiat; tapping a code opens a detail sheet with meaning, freeze frame, guide links, "Explain with AI"
and a web search link.

## Why

`src/shared/obd-core/obd/dtc.ts` has a 21-entry `DTC_DICTIONARY`; everything else shows
"Powertrain code P0135 (generic — no local description)". `udsModule.ts`, `aiDiagnosis.ts`,
`dtcReport.ts`, module-scan and history all consume `Dtc.description`, so one data module lifts the
whole app.

## Read first

- `src/shared/obd-core/obd/dtc.ts` (`Dtc`, `DTC_DICTIONARY`, `describeDtc`, `toDtc`,
  `vagCodeForDtc`, `parseDtcBytes`) and `dtc.test.ts` (keeps: `P0299` → /underboost/, `P3FFF` →
  /Powertrain/, `P2183` → /coolant temperature/, `P2015` → /intake manifold/, `P0121` → /throttle/).
- `src/shared/obd-core/uds/vagDtcs.ts` (14 VAG texts, 5-digit keyed) and `udsModule.ts` line ~65
  (`description: vagText ?? describeDtc(sae)`).
- `src/features/fault-codes/{ui/FaultCodesScreen.tsx (DtcRow, Section), api/dtcService.ts,
model/dtcStore.ts, hooks/useDtcs.ts}`.
- `src/shared/vehicles/faultGuides.ts` (`matchFaultGuide`) — the detail sheet reuses it.
- `src/shared/obd-core/analysis/aiDiagnosis.ts` (`buildDiagnosisMessages`) — "Explain with AI".
- `src/shared/vehicles/types.ts` `VehicleProfile` — add `make`.
- `docs/features/fault-codes.md`, `docs/obd2-reference.md` § DTC.

## Design

### Data module `src/shared/obd-core/obd/dtcDatabase/`

```
dtcDatabase/
├── index.ts          # lookupDtc(), types, range tables, severity rules
├── generic/
│   ├── p0.ts         # P0000–P0FFF  (Record<string,string>, ~1 500 entries)
│   ├── p2.ts         # P2000–P2FFF  (~700)
│   ├── p3.ts         # P3400–P34FF generic block (~100)
│   ├── b0.ts, c0.ts  # generic body / chassis (small)
│   └── u0.ts         # U0001–U0400 network (~300)
├── manufacturer/
│   ├── vag.ts        # P1xxx / P3xxx VAG texts keyed by SAE code; plus 5-digit VAG → text (merge vagDtcs.ts here, re-export from uds/vagDtcs.ts for compatibility)
│   └── fiat.ts       # P1xxx Fiat / FGA texts (start with the ~60 most common)
└── dtcDatabase.test.ts
```

API (all pure):

```ts
export type DtcMake = 'vag' | 'fiat' | 'generic';
export type DtcSeverity = 'info' | 'moderate' | 'high' | 'unknown';
export interface DtcInfo {
  code: string;
  description: string;
  system: 'powertrain' | 'chassis' | 'body' | 'network';
  /** From the SAE range table, e.g. 'Fuel & air metering', 'Ignition system / misfire', 'Auxiliary emission controls', 'Transmission', 'Hybrid propulsion'. */
  subsystem: string;
  severity: DtcSeverity;
  manufacturerSpecific: boolean; // second char is 1 (or 3 for P3 outside the generic block), or B1/C1/U1 ranges
  source: 'generic' | 'vag' | 'fiat' | 'range'; // 'range' = no entry, description synthesised from the subsystem
}
export function lookupDtc(code: string, make: DtcMake = 'generic'): DtcInfo;
export function describeDtc(code: string, make?: DtcMake): string; // = lookupDtc(...).description; dtc.ts re-exports this
```

Range table (subsystem by `P0xyy` x-digit): `00` fuel & air metering (aux emission), `01`–`02`
fuel & air metering, `03` ignition / misfire, `04` auxiliary emission, `05` vehicle speed / idle
control, `06` computer & output circuits, `07`–`09` transmission, `0A`–`0C` hybrid propulsion;
`P2xxx`/`P34xx` use the J2012 generic grouping; `U0xxx` network communication (bus, lost comm,
software incompatibility); `B0`/`C0` body/chassis generic.

Severity rules (ordered, first match): `P030x`/`P031x` misfire → `high`; `P0A`/`P0B` hybrid →
`high`; `P0217`/`P0218` overheat → `high`; `P0520`–`P0524` oil pressure → `high`; `P0335`/`P0336`
crank sensor → `high`; `U0100`–`U0199` lost communication → `moderate`; `P04xx` emissions,
`P2002`-class DPF, `P0420`/`P0430` catalyst → `moderate`; `P06xx` computer → `moderate`;
everything else with an entry → `info`; no entry → `unknown`. Keep the table small and exported
so the test can enumerate it.

Fallback description when no entry: `${subsystem} fault (${code})` — never the old "no local
description" wording; `dtc.test.ts`'s `P3FFF → /Powertrain/` still passes because `system` is
rendered in the synthesised text as `Powertrain — <subsystem> fault (P3FFF)`.

### Data sourcing rules (write these in the module header)

- Descriptions are the standardized SAE J2012 / ISO 15031-6 definitions. Author them yourself; keep
  the wording short and canonical ("Mass or Volume Air Flow A Circuit Range/Performance").
- **Do not copy from GPL sources** (python-OBD's `codes.py` is GPL-2). If you use a list, verify an
  MIT/BSD/public-domain license and cite URL + license in the file header.
- One file per family; ≤ 1 800 lines each; keys uppercase 5-char; no duplicates (test enforces).
- Size budget: the whole module ≤ 350 KB of TS source. It is bundled statically (RN cannot lazy-load
  modules without extra tooling); measure with `npx expo export --platform android` bundle size
  before/after and record the delta in the PR.

### `make` on profiles

`VehicleProfile.make?: DtcMake` — Golf and Passat `'vag'`, Punto `'fiat'`, generic undefined.
`dtcService.readAll()` re-describes: `stored.map((d) => toDtc(d.code, profile.make))`
(`toDtc(code, make?)` in `dtc.ts`). The core `readDtcs` stays generic (no profile knowledge in the
session). `udsModule.ts` already prefers VAG 5-digit text; swap its fallback to
`describeDtc(sae, 'vag')`.

### Detail sheet (`src/features/fault-codes/ui/DtcDetailSheet.tsx`)

Tamagui `Sheet` (`modal`, `snapPoints={[85]}`) opened by tapping the code text in `DtcRow`
(keep the inline **Guide** button). Content, top to bottom:

1. Header: code (large), VAG 5-digit when `vagCodeForDtc(code)` is non-empty, severity badge
   (`StatusBadge`-like colours: high red, moderate amber, info blue, unknown grey).
2. Description; `system · subsystem`; "Manufacturer-specific" chip when applicable.
3. Freeze frame for this code (reuse the existing block from `DtcRow`).
4. Guide (`matchFaultGuide`) note + the existing deep-link buttons.
5. Actions row: **Explain with AI** → `router.push({ pathname: '/ai-diagnose', params: { focus: code } })`;
   **Search the web** → `Linking.openURL('https://www.google.com/search?q=' + encodeURIComponent(code + ' OBD2 ' + (profile.name ?? '')))`;
   **Copy** → `expo-clipboard` is not installed — use `Share.share({ message })` from RN instead.
6. Footer paragraph: "Descriptions follow SAE J2012. Causes and fixes vary by car; use the guide
   and freeze frame before replacing parts."

`ai-diagnose`: `AiDiagnoseScreen` reads `useLocalSearchParams<{ focus?: string }>()`; when present
it passes `focusCode` into `diagnoseService.run({ focusCode })` → `buildDiagnosisMessages(snapshot,
{ focusCode })` appends one user line: "Focus on fault code P0135: explain it in plain words, likely
causes in order of probability, and what to check first." Pure change in `aiDiagnosis.ts` + test.

### Settings QA hook

Plan 01 adds the **Custom…** injected-DTC input; if plan 01 has not landed, add it here (same
spec).

## Steps

1. Create `dtcDatabase/` with types, range table, severity rules, empty data files; wire
   `describeDtc`/`toDtc` in `dtc.ts` to delegate; move `vagDtcs.ts` content into
   `manufacturer/vag.ts` and re-export from the old path. Run the suite — all existing tests must
   still pass.
2. Fill `generic/p0.ts` (whole family), then `p2.ts`, `u0.ts`, `p3.ts`, `b0.ts`, `c0.ts`.
3. `manufacturer/vag.ts` P1xxx (start with EDC17/common 1.9–2.0 TDI codes: P1xxx glow plug, EGR,
   boost, DPF, swirl flap, G-sensor circuits) and `fiat.ts`.
4. `types.ts` `make`; profiles; `dtcService` + `udsModule` make-aware.
5. `DtcDetailSheet.tsx`; `DtcRow` tap; ai-diagnose `focus` param; `aiDiagnosis.ts` option.
6. Docs; bundle-size measurement; `npm run ci`.

## Tests

- `dtcDatabase.test.ts`:
  - coverage floors: `Object.keys(P0).length ≥ 1400`, `P2 ≥ 600`, `U0 ≥ 250`;
  - every key matches `/^[PCBU][0-9A-F]{4}$/` and is unique across files;
  - spot checks: `P0101` /mass.*air.*flow/i, `P0420` /catalyst/i, `P0300` /random.*misfire/i,
    `U0100` /lost communication.*ECM/i, `P2183` /coolant/i, `P0135` /O2|oxygen.\*heater/i;
  - severity: `P0301 → high`, `U0121 → moderate`, `P0171 → info`, `P0FFF → unknown`;
  - `lookupDtc('P1xxx', 'vag')` returns `source 'vag'` for a seeded code and `manufacturerSpecific`
    true; same code with `'generic'` → `source 'range'`;
  - fallback text contains the subsystem and the code.
- `dtc.test.ts` unchanged and green.
- `aiDiagnosis.test.ts`: `buildDiagnosisMessages(snap, { focusCode: 'P0135' })` ends with a user
  message mentioning `P0135`.

## Docs

- `docs/features/fault-codes.md`: "DTC database" (files, API, severity rules, sourcing rule) and
  "Detail sheet" sections; Acceptance updated.
- `docs/obd2-reference.md` § DTC: pointer to the database and the range table.
- `docs/features/ai-diagnose.md`: `focus` parameter.
- `docs/vehicles/README.md`: `make` field.

## Acceptance

- [ ] Simulator, **Custom…** `P0135,P0301,U0121`: Faults shows real descriptions; sheet shows
      severity high for `P0301`.
- [ ] Module scan (Golf simulator) VAG codes still show VAG text; unknown ones show generic text.
- [ ] History and the HTML report render the new descriptions (no code change expected — verify).
- [ ] **Explain with AI** lands on the AI screen with the code pre-focused (visible in the request
      preview or the local heuristic report header).
- [ ] Bundle delta recorded in the PR; `npm run ci` green.

## Deferred until an on-car session

Added when the plan landed: the Fiat / FGA `P1xxx` pack (`manufacturer/fiat.ts`, `FIAT_P1`) ships
**empty**. No Fiat P1 definition could be stated with confidence from published sources (meanings
differ between Marelli IAW petrol and Bosch EDC16 / EDC17 Multijet diesel modules), and a wrong
manufacturer text is worse than the honest range fallback. Everything else in this plan, including
the `'fiat'` make wiring (tested with a seeded entry), is shipped.

Procedure (owner, Punto 2008-12):

1. Connect Multiecuscan (or the dealer tool) to the engine ECU and read stored faults; also note any
   P1 code the app shows as `Powertrain — <subsystem> fault (P1xxx)` on the Faults screen.
2. For each P1 code, record the code, the tool's exact text and the ECU part / software number.
3. Agent: add one `FIAT_P1` entry per confirmed code, in short canonical wording, with the ECU
   family in a comment when the text is engine-specific; keep keys upper-case and unique (the
   database test enforces it). Then raise the Fiat floor in `dtcDatabase.test.ts` to the count
   added and flip the roadmap note.
