# Feature: fault-codes

Read and clear Diagnostic Trouble Codes (DTCs), show freeze frame and readiness monitors. Every read is saved to [History](./history.md).

## UI
- **FaultCodesScreen** — three sections: **Stored** (Mode 03), **Pending** (Mode 07),
  **Permanent** (Mode 0A). Each code shows the code string (e.g. `P0299`) + a description.
- **Readiness** panel — MIL on/off + monitor readiness from PID `0101`.
- **Freeze frame** — values captured when a code set (Mode 02), shown for the first stored code.
- **Clear** button — confirmation dialog → Mode 04 → re-read.

## hooks
- `useDtcs()` — read stored/pending/permanent; expose loading/error.
- `useClearDtcs()` — clear + refresh, with a confirm step.
- `useReadiness()` — parse PID `0101`.

## api (service layer)
- `dtcService` — issues Mode 03/07/0A, decodes 2-byte DTCs (see
  [`../obd2-reference.md`](../obd2-reference.md)), looks up descriptions, and runs Mode 04 for clear.

## model
- `dtcStore` (Zustand): `stored[]`, `pending[]`, `permanent[]`, `mil`, `monitors`, `freezeFrame`.

## Behavior
- Decoding maps the first two bits to `P/C/B/U` and assembles the 4-character code.
- Descriptions come from a small generic dictionary; unknown codes get a range-based generic label.
- **Clearing is destructive** (erases codes, resets readiness) — always confirm; warn that codes may
  return if the fault persists.

## Acceptance
- Decodes known fixtures correctly (`01 33 → P0133`, `02 99 → P0299`, etc.).
- Clears via Mode 04 and the list refreshes to empty in the simulator.
- Works on K-line (Passat) and CAN (Golf) simulated cars.
