# Plan 22 — KWP login entry and the per-car code book

**Size:** M (1 day) · **Depends on:** plan 06 (`UserVehicle` for user-entered codes), plan 13
optional (import/export carries the book) · **Roadmap:** v0.6 "KWP login UI + code book"

## Goal

Pre-UDS VAG modules (KWP2000) require a **login** before accepting adaptation writes — the five-digit
number VCDS asks for in its "Login – 11" screen. The app gets: a core `kwpLogin` primitive, a
per-car **code book** the user fills in (profiles may carry documented defaults), an **entry sheet**
shown before a KWP adaptation write, a **KWP transport** for adaptation channels (`21` read /
`3B` write) on K-line, and full simulator coverage. The app ships **no login codes** of its own
beyond what the owner enters or a profile documents from the owner's own VCDS history.

## Why

`docs/vcds-parity-roadmap.md` lists "KWP login (`2B`) UI + code book" as the last ⏳ item. The UDS
write paths exist; K-line KWP helpers exist (`kwpStartRoutine`, `kwpReadLocal`, `kwpWriteLocal`,
`enterSession(send, 0x85)` in `src/shared/obd-core/coding/udsCoding.ts`) but nothing performs a
login, and `AdaptationChannel` is UDS-only (`22`/`2E`).

## Transport map (write this into the docs verbatim)

| Module class                                                    | Link                   | Unlock mechanism                       | Reachable with a generic ELM327?                                               |
| --------------------------------------------------------------- | ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| UDS modules (Golf engine EDC17, newer PQ35 modules)             | CAN ISO-TP             | `27` SecurityAccess seed/key → plan 23 | Yes                                                                            |
| Pre-UDS PQ35 modules (cluster `17`, comfort `46`, gateway `19`) | KWP2000 over **TP2.0** | `2B` login (this plan)                 | Only via the TP2.0 raw-CAN link (`tp20/`), timing-sensitive — deferred section |
| K-line KWP2000 engine ECU (Passat B5.5 `01`)                    | ISO 14230 fast init    | `2B` login (this plan)                 | Yes — testable now                                                             |
| K-line **KWP1281** modules (Passat cluster/comfort/HVAC)        | ISO 9141 byte-ACK      | —                                      | **No.** Hardware limit; stays honest in the UI                                 |

## Read first

- `src/shared/obd-core/coding/udsCoding.ts` — `UdsSend`, `checkNegative`, `enterSession`,
  `kwpReadLocal`, `kwpWriteLocal`, `kwpStartRoutine`, `hexBytes`, `UdsError`, `nrcName`,
  `isModuleUnreachableError`; the `serviceResetKwp` flow (session `0x85` → optional unlock → write).
- `src/shared/vehicles/types.ts` — `AdaptationChannel`, `ServiceReset.transport`, `VehicleProfile`;
  `src/shared/vehicles/passat-b55-19tdi.ts` (`serviceReset` KWP descriptor, `obdUnreachable`).
- `src/features/adaptations/{api/adaptationService.ts, hooks/useAdaptations.ts,
model/adaptationsStore.ts, ui/AdaptationsScreen.tsx}` — `readChannel`, `writeChannel`,
  `checkBounds`, the `unlocked` gate, the confirm flow.
- `src/shared/obd-core/transport/MockTransport.ts` — `respondObd`: `10`, `3E00`, `31`, `27`,
  `2E`, `22` handlers; no `2B`, `21`, `3B` handlers exist (K-line `serviceResetKwp` only works in
  the sim because `31` echoes positive).
- `src/shared/obd-core/transport/scenarios.ts` — `buildScenario`, `mergeCoding`.
- `src/features/service-reset/hooks/useServiceReset.ts` lines 38–50 (how a KWP descriptor is run).
- `docs/features/adaptations.md`, `docs/features/service-reset.md` § K-line, `docs/features/tp20.md`.

## Design

### Core (`src/shared/obd-core/coding/kwpLogin.ts`, pure, exported from `obd-core/index.ts`)

```ts
/** VAG KWP2000 login (VCDS "Login – 11"). `code` is the 5-digit number (0–65535); `wsc` the
 *  workshop code (0–99999, default 0). Positive response 0x6B. Throws UdsError on 7F 2B xx. */
export async function kwpLogin(send: UdsSend, code: number, wsc = 0): Promise<void>;
/** Format/parse helpers for the UI: 5-digit zero-padded text <-> number, range-checked. */
export function formatLoginCode(code: number): string; // 12345 -> '12345'
export function parseLoginCode(text: string): number | null; // '01234' -> 1234; 'abc' -> null; > 65535 -> null
```

Request bytes: `2B` + 2-byte big-endian code + 3-byte big-endian workshop code (`hexBytes`).
`checkNegative(0x2b, res)`; NRC `0x35` → the UI text "Login code rejected"; `0x36`/`0x37` reuse the
lockout texts already in `routineService.describeRoutineFailure` (factor them into a shared
`describeUnlockFailure(err)` in `udsCoding.ts` so routines, service reset and adaptations say the
same thing).

### Code book

```ts
// src/shared/vehicles/types.ts
export interface LoginCodeEntry {
  /** VAG module address as VCDS shows it ('17' cluster, '46' comfort, '01' engine). */
  address: string;
  code: number; // 0–65535
  wsc?: number; // workshop code, default 0
  purpose: string; // 'Service interval adaptation', …
  /** Where it came from; profiles only ever carry codes documented from the owner's own VCDS logs. */
  source: 'owner-vcds-log' | 'user-entered' | 'documented';
  confirmed?: Confirmation; // plan 25
}
// VehicleProfile.loginCodes?: LoginCodeEntry[]   (registry profiles)
// UserVehicle.loginCodes?: LoginCodeEntry[]      (plan 06; persisted in garageStore, exported by plan 13)
```

Resolution (pure, `src/shared/vehicles/loginBook.ts`): `loginCodeFor(profile, userVehicle,
address): LoginCodeEntry | null` — user entry wins over the profile's. **Never** persist a code
typed only for one write unless the user ticks "Remember for this car".

### Adaptation channels over KWP

`AdaptationChannel` gains `transport?: 'uds' | 'kwp'` (default `'uds'`) and `login?: boolean`
(KWP only: a login is required before writing). For `transport: 'kwp'`:

- `readChannel`: `enterSession(send, ch.session ?? 0x85)` once per screen session (cache in the
  hook), then `kwpReadLocal(send, ch.did)` (`did` is the 2-hex local identifier).
- `writeChannel(session, ch, newRaw, opts?: { login?: { code: number; wsc?: number } })`: bounds
  check (unchanged) → session → `kwpLogin` when `ch.login` → backup via `kwpReadLocal` →
  `kwpWriteLocal` → re-read → verify. Returns the same `WriteOutcome`. When `ch.login` is set and
  no `opts.login` is supplied, return `{ ok: false, message: 'Login required' }` **before** any bus
  traffic.
- Header handling: on K-line `setHeader` applies the ISO 14230 physical address (the profile's
  `reqHeader`, e.g. `'C233F1'`-style functional default is restored by `resetAddressing()` already).
  Keep the existing `finally { resetAddressing() }`.

### UI

- `AdaptationsScreen` `ChannelRow`: for `ch.login`, the **Write** confirm step first opens
  `LoginSheet.tsx` (new, `src/features/adaptations/ui/`): five-digit numeric `Input` (masked as
  `•••••` with a reveal toggle), optional WSC, pre-filled from `loginCodeFor(...)`, checkbox
  "Remember for this car" (→ `garageStore.update(id, { loginCodes })` for user vehicles; for a
  registry profile the remembered code is stored on an auto-created shadow entry in a new
  `loginBookStore` keyed by `historyVehicleKey`), then the existing before→after confirm.
- Status line under the channel: "Login: remembered (17 · service)" / "Login: needed" / none for
  UDS channels.
- Vehicle editor (plan 06 `VehicleEditorSheet`): a **Login codes** section listing entries with
  address, purpose, masked code, delete.
- Passat: channels whose module is KWP1281 are never declared (profile data), and the screen keeps
  its honest unavailability paragraph; add one sentence pointing at the service-reset manual
  procedure.

### Simulator

`SimScenario` gains:

```ts
/** KWP local identifiers per header (or '*' for the functional/K-line single ECU): lid -> bytes. */
kwpLocals?: Record<string, Record<string, number[]>>;
/** Login codes the simulated module accepts: header | '*' -> { code, wsc? }. Writes to kwpLocals
 *  marked in `kwpLoginRequired` answer 7F 3B 33 until a matching 2B succeeded in this session. */
kwpLogins?: Record<string, { code: number; wsc?: number }>;
kwpLoginRequired?: string[];   // lids that need login
```

`respondObd`: `2B` + 10 hex → compare against `kwpLogins[header ?? '*']` → `6B` or `7F2B35`; set
`this.loggedIn[header]`. `21 <lid>` → `61 <lid> <bytes>` from `kwpLocals`, else `NO DATA`.
`3B <lid> <data>` → `7B <lid>` and store, or `7F3B33` when login required and not logged in, or
`7F3B31` for an unknown lid. A `10 xx` resets `loggedIn` for that header (session restart), like a
real module. `buildScenario` seeds `kwpLocals` from channels with `transport: 'kwp'` using
`sampleValue`, and `kwpLogins` from the profile's `loginCodes` (so the Passat scenario can be
exercised with a documented code **only if the profile carries one**; otherwise tests pass the
override explicitly).

Passat profile: add one illustrative KWP channel for the **engine** ECU (`address '01'`, lid
`'2A'` "Idle speed adaptation", 1 byte, bounds, `transport: 'kwp'`, `login: true`,
`experimental: true`) so the whole flow runs in the simulator; the docs state it is a placeholder
until a capture confirms it.

## Steps

1. `kwpLogin.ts` + test; `describeUnlockFailure` refactor (routines keep behaviour; test).
2. Types: `LoginCodeEntry`, `loginCodes`, `AdaptationChannel.transport/login/session`;
   `loginBook.ts` + test.
3. Simulator: scenario fields, handlers, `buildScenario` seeding; `MockTransport.test.ts` cases.
4. `adaptationService` KWP paths + `WriteOutcome` login refusal; `useAdaptations` login plumbing
   - `loginBookStore` (persisted `bolid.loginBook` v1).
5. `LoginSheet.tsx`, `ChannelRow` changes, vehicle editor section.
6. Passat illustrative channel + doc; docs below; `npm run ci`.

## Tests

- `kwpLogin.test.ts`: request bytes for code 12345 / wsc 0 are `2B 30 39 00 00 00`; `6B` resolves;
  `7F 2B 35` throws `UdsError` with nrc 0x35; `parseLoginCode('65536')` is null; `formatLoginCode(7)`
  is `'00007'`.
- `loginBook.test.ts`: user entry overrides profile entry for the same address; missing → null.
- `MockTransport.test.ts`: `3B` refused with `7F3B33` before login, accepted after `2B` with the
  right code, refused again after `10 85`; wrong code → `7F2B35`; `21` returns seeded bytes.
- `adaptationService.test.ts` (new, runs against `MockTransport` through a `DiagnosticSession` on
  the Passat scenario with an override login): `writeChannel` without `opts.login` → `ok false`,
  no commands sent (assert via a logging transport wrapper); with the code → verified; out-of-bounds
  → refused before traffic; wrong code → message contains "rejected".
- Existing `udsCoding.test.ts`, `routineService.test.ts` unchanged.

## Docs

- `docs/features/adaptations.md`: KWP transport, login sheet, code book, remember semantics, the
  transport map table above.
- `docs/features/vehicle-select.md`: login codes in the editor.
- `docs/vehicles/passat-b55-19tdi.md`: the illustrative KWP channel (front-matter unaffected — it is
  not an extended PID) and the KWP1281 limit restated.
- `docs/simulator.md`: `kwpLocals` / `kwpLogins`.
- `docs/vcds-parity-roadmap.md`: flip the ⏳ row to ✅ (code) with a pointer to the deferred part.

## Acceptance

- [ ] Passat simulator: the KWP channel reads; Write opens the login sheet; wrong code → "Login
      code rejected", nothing written; right code → write verified; **Remember** → next write skips
      the sheet; session restart in the sim (`10 85`) requires login again and the app handles it.
- [ ] Golf simulator: UDS channels unchanged; no login sheet ever appears.
- [ ] A remembered code is stored in the garage/login book, never in `bolid.settings`.
- [ ] `npm run ci` green.

## Out of scope

Deriving or shipping login codes (the app only stores what the owner enters or documents from
their own VCDS logs); UDS `27` seed/key (plan 23).

## Deferred until an on-car session

**TP2.0 pre-UDS adaptations (Golf cluster `17`, comfort `46`).** Code path: `Tp20Channel.request`
already carries KWP payloads; a `Tp20Send` adapter (`(cmd) => channel.request(hexToBytes(cmd))`)
would let `kwpLogin` / `kwpReadLocal` / `kwpWriteLocal` run unchanged. Do **not** wire writes until:

1. `probeTp20Capability(client)` returns `ok` on the Vgate with the Golf (frames seen ≥ 1).
2. `scanTp20` lists the cluster and comfort modules with idents matching the VCDS auto-scan
   (`docs/vehicles/golf-plus-2009-20tdi.md` → module `17` part number).
3. A sniffer capture (plan 03) of VCDS doing "Login – 11" on module `17` is analysed with plan 25's
   analyzer to confirm the `2B` payload layout on this car; record the capture file name in the
   channel's `confirmed.fixture`.
4. Only then add `transport: 'tp20'` channels to the Golf profile and enable the write path behind
   the same unlock + login sheet.

Record every step in the vehicle doc's "Validated on the car" table (plan 02 format).
