# Feature: adaptations — channel browser (experimental, write-capable, gated)

VCDS-style **adaptation channels**: small numeric module values (idle offset, base duties, service
counters…) read via UDS `22` and written via `2E` (CAN), or — on K-line KWP2000 modules — read via
`21` and written via `3B` after an optional `2B` **login** (plan 22), with the coding feature's
full guardrails — unlock gate, mandatory backup, bounds checking, verify-after-write, restore.

> ⚠️ **DANGER / EXPERIMENTAL.** Channel DIDs, scaling and safe bounds are per-module and NOT
> standardized. Shipped channels are **illustrative** and must be confirmed on the real car.
> Channels that require SecurityAccess are **read-only** unless the profile supplies a real
> seed/key algorithm (none ship). The app ships **no login codes**: the code book holds only what
> the owner enters (or a profile documents from the owner's own VCDS logs). K-line modules that
> speak **KWP1281** (Passat cluster / comfort / HVAC) stay out of reach of a generic ELM327 — the
> screen says so honestly.

## Transport map

| Module class                                                    | Link                   | Unlock mechanism                       | Reachable with a generic ELM327?                                               |
| --------------------------------------------------------------- | ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| UDS modules (Golf engine EDC17, newer PQ35 modules)             | CAN ISO-TP             | `27` SecurityAccess seed/key → plan 23 | Yes                                                                            |
| Pre-UDS PQ35 modules (cluster `17`, comfort `46`, gateway `19`) | KWP2000 over **TP2.0** | `2B` login (this plan)                 | Only via the TP2.0 raw-CAN link (`tp20/`), timing-sensitive — deferred section |
| K-line KWP2000 engine ECU (Passat B5.5 `01`)                    | ISO 14230 fast init    | `2B` login (this plan)                 | Yes — testable now                                                             |
| K-line **KWP1281** modules (Passat cluster/comfort/HVAC)        | ISO 9141 byte-ACK      | —                                      | **No.** Hardware limit; stays honest in the UI                                 |

"This plan" is [plan 22](../plans/22-kwp-login-code-book.md). The TP2.0 row is its deferred part:
`Tp20Channel.request` already carries KWP payloads, but no `transport: 'tp20'` channel is declared
until the TP2.0 link and the `2B` payload layout are confirmed on the Golf.

## Model

- Profiles gain `adaptations?: AdaptationChannel[]` — module + headers, DID, `byteCount`,
  display scaling (`scale`/`offset`), display bounds (`min`/`max`), optional `defaultRaw`,
  optional `security` (⇒ read-only), simulator `sampleValue`. Since plan 22 a channel may also set
  `transport: 'kwp'` (default `'uds'`; `did` is then the 1-byte KWP local identifier), `login:
true` (a `2B` login is required before writing), `session` (KWP session byte, default `0x85`)
  and `address` (the VAG module address VCDS shows, e.g. `'01'` — the code-book key).
- UDS channels are offered on a CAN link, KWP channels on a K-line link; the rest stay hidden.
- Value math is pure + unit-tested: `obd-core/coding/adaptationValue.ts`
  (`decodeAdaptationRaw` / `encodeAdaptationValue`, clamped big-endian).
- `adaptationsStore` (Zustand): `unlocked`, `values`, `backups` (last 50), `lastResult`, `running`.

## Label packs (`src/shared/labels/`)

The open equivalent of VCDS label files: a `LabelPack` names measurements, coding bits and
adaptation channels for a module FAMILY, keyed by **part-number prefix** (matched against the live
`F187` ident from [module-scan](./module-scan.md); longest prefix wins). Packs are data,
community-extensible; `vag-edc17-03L906022` ships as the illustrative example. The adaptations
screen shows the pack's channel descriptions when the scanned part number matches.

Fields: `measurements` (DID → name / unit), `codingBits` (coding DID → byte / bit names),
`adaptations` (DID → name / unit / description) and, since plan 14, **`measuringGroups`**:

```ts
interface MeasuringGroup { name: string; dids: string[]; description?: string } // ≤ 4 DIDs
measuringGroups?: Record<string, MeasuringGroup>; // key = group number as VCDS shows it: '001', '075'
```

VCDS-style numbered groups of up to four measuring values. `measuringGroups(pack)` (registry) lists
them sorted by group number with each group capped at four upper-cased DIDs; a DID the pack has no
`measurements` label for is still listed (the UI falls back to the profile's DID name). The
[Extended PIDs](./extended-pids.md#measuring-groups) screen shows them live, resolving the pack from
the engine part number read at connect. The Golf pack's three groups (`075` DPF, `099`
temperatures, `120` EGR / injection) are illustrative until a capture confirms them (plan 25).

## KWP login (plan 22)

Pre-UDS VAG modules (KWP2000) accept adaptation writes only after a **login** — the five-digit
number VCDS asks for in "Login – 11".

- **Core** (`obd-core/coding/kwpLogin.ts`, pure): `kwpLogin(send, code, wsc = 0)` sends `2B` +
  2-byte big-endian code + 3-byte big-endian workshop code (12345 / 0 → `2B 30 39 00 00 00`);
  positive `6B`; `7F 2B 35` throws `UdsError` (nrc `0x35`, "Login code rejected"). Helpers:
  `formatLoginCode` (7 → `'00007'`), `parseLoginCode` (1–5 digits, 0–65535, else null),
  `parseWorkshopCode`, `describeLoginFailure` (0x35 rejected, 0x33 refused without login, else
  the shared lockout texts). `describeUnlockFailure(err)` in `udsCoding.ts` holds the NRC
  0x36 / 0x37 lockout texts that routines, service reset and adaptations now share.
- **KWP channel read**: `10 <session>` (once per screen session — the hook caches the opened
  module header and skips the `10` on the next read; `AdaptationsScreen` provides one
  `KwpSessionCacheContext` that every row's hook shares, so two channels on one header send a
  single `10`; the cache empties when the link changes) → `21 <lid>`.
- **KWP channel write** (`writeChannel(session, ch, raw, { login? })`): bounds check → `10
<session>` (always, so a module that dropped its session is logged in again) → `2B` when
  `ch.login` → backup `21` → `3B` → re-read `21` → verify. Same `WriteOutcome`, plus
  `loginRejected` (NRC 0x35) / `loginRequired` / `loginAccepted` (the `2B` got its `6B`; set even
  when a later step fails). A login channel called without a code returns `{ ok: false,
message: 'Login required …' }` **before any bus traffic**. `resetAddressing()` in `finally`.
- **Header**: on K-line `setHeader` applies the channel's `reqHeader` (ISO 14230 physical
  address, e.g. `8101F1`); no receive filter is sent; `resetAddressing()` restores the protocol's
  functional header.

## Code book

`LoginCodeEntry { address, code, wsc?, purpose, source: 'owner-vcds-log' | 'user-entered' |
'documented' }` (`shared/vehicles/types.ts`).

- **Where codes live.** A garage car keeps its codes on `UserVehicle.loginCodes` (`bolid.garage`,
  so the garage export carries them). A registry car keeps them on a shadow entry in the **login
  book** — `loginBookStore`, persisted as `bolid.loginBook` v1, keyed by `historyVehicleKey`
  (`vin:<VIN>` when the car reported one, else `id:<profile>`). A lookup reads only the car's
  **primary** key — the VIN key once the car reported a VIN, else the profile-id key — so a car
  never treats another car's code as its own. Once a VIN is known, a code filed under the
  profile-id key earlier (`preVinCodeBook`; any car on that profile could have filed it) only
  **pre-fills** the sheet, which says so ("a code saved before this car's VIN was known"); it is
  never sent without the sheet, and this car's rejection or **Forget** never deletes it. A profile
  may carry `loginCodes` documented from the owner's own VCDS logs (none do today); a garage car
  inherits them from its base. Codes are **never** in `bolid.settings`. Both stores are in the
  backup file (plan 18), so a backup holds the codes in plain text.
- **Resolution** (`shared/vehicles/loginBook.ts`, pure): `loginCodeFor(profile, userBook,
address)` — the user's entry wins over the profile's; one code per module address
  (`upsertLoginCode` replaces, `removeLoginCode`); `sanitizeLoginCodes` drops malformed persisted
  entries.
- **Remember semantics.** A code typed into the login sheet is used for that one write and
  forgotten, unless the user ticks **Remember for this car** — then it is stored **after the
  module accepted the login** (`loginAccepted`; a code is never stored after a rejection, a
  refusal before any traffic, a failed session start, a dead link or a lockout). A remembered code
  skips the sheet on the next write; if the module rejects it, it is **forgotten** and the next
  write opens the sheet again — never pre-filled with the code just rejected. **Forget** (on the channel's status line) or the vehicle editor's **Login
  codes** section deletes it. The code never goes into the error log, and the `2B` request is
  redacted (`redactCommand` → `2B <login code redacted>`) in the adapter I/O log, in replay
  fixtures exported from it and in an ELM timeout's error text.

## Login sheet

`LoginSheet.tsx` opens when **Write** (or a restore) is pressed on a `login` channel and no
remembered code applies: a five-digit numeric field masked as `•••••` with a **Show** / **Hide**
toggle, an optional workshop code, the **Remember for this car** checkbox, and **Continue**, which
leads into the usual before → after confirm. It is pre-filled from the code book (a documented
profile code pre-fills but never skips the sheet). The channel's status line reads "Login:
remembered (01 · Idle speed adaptation)" with **Forget**, or "Login: needed"; UDS channels show
none. On a K-line link the screen also states the KWP1281 limit and links to the Service reset
screen's manual procedure.

## api / hooks / UI

- `adaptationService.readChannel/writeChannel` — header addressing + `codeModule` (backup →
  write → verify) reuse for UDS; the KWP path above for `transport: 'kwp'`; security-locked
  channels never attempt a write.
- `useAdaptations()` — link + profile gating (UDS on CAN, KWP on K-line), bounds validation,
  backup/restore, label enrichment, the code book (`loginInfo`, `forgetLogin`; `write` / `restore`
  take an optional `LoginInput`), the per-screen KWP session cache.
- `api/codeBook.ts` — `userCodeBook`, `preVinCodeBook`, `loginFor`, `rememberLoginCode`,
  `forgetLoginCode`, `loginBookKeys` over the garage store and the login book.
- **AdaptationsScreen** — unlock switch (off = read-only), per channel: current value, read,
  numeric editor with explicit before→after confirm, restore-from-backup and restore-known-default.
- **Bounds guard.** `checkBounds` is a one-line wrapper over the core
  `adaptationBoundsError(ch, raw)` (`obd-core/coding/adaptationValue.ts`): non-null when the raw
  bytes are not `byteCount` wide or decode outside `min`/`max`. `writeChannel` applies it to every
  write, whoever calls it.
- **Restore from a full-car backup.** Coding → Backup can also write channels (plan 24, see
  [coding](./coding.md#full-backup--clone-my-car-6b8)): it plans per channel against a fresh read
  and sends each restore through this feature's `writeChannel` — same bounds guard, backup and
  verify — behind **this feature's unlock** (`adaptationsStore.unlocked`). The replaced values land
  in `adaptationsStore.backups`, so the Adaptations screen can undo a restore.

## Acceptance

- Golf simulator: both channels read (850 rpm / 50 %), a bounded write round-trips and verifies,
  out-of-bounds values are rejected before any bus traffic, restore returns the original.
- Locked (default): no write control is reachable. Punto: honest unavailability note.
- Passat simulator (K-line): the illustrative KWP engine channel (`2A`, idle speed adaptation)
  reads 850 rpm; **Write** opens the login sheet; a wrong code → "Login code rejected", nothing
  written; the right code → write verified; **Remember** → the next write skips the sheet; a
  session restart (`10 85`) needs the login again and the app sends it. The in-app simulator
  accepts only its placeholder `12345` (see [simulator](../simulator.md)).
- Golf simulator: UDS channels unchanged; no login sheet ever appears.
