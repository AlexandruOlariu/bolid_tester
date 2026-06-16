# Feature: error log

A persistent, on-device **logging zone**: a capped store of the errors the app has hit, so they can
be reviewed and **exported to fix later**. File-backed (expo-file-system) like history/settings, so
it survives app restarts. Reachable from the **More** tab (`/error-log`).

## What gets recorded
- **Caught feature errors** — wired into the existing `catch` blocks via `logError(...)`:
  `connection` (connect failures, incl. the chosen adapter source), `fault-codes` (DTC read
  failures), `ai-diagnose` (gather/analyse failures). Each call keeps the feature's own
  user-facing error handling and *additionally* records the error in the zone.
- **Uncaught errors** — `installGlobalErrorHandlers()` (called once at app start in
  `app/_layout.tsx`) chains React Native's `ErrorUtils` global handler and the web
  `unhandledrejection` event, so crashes and unhandled promise rejections are captured as `global` /
  `unhandledRejection` entries. The previous handler is preserved (red-box / crash behaviour is
  unchanged).
- **Export failures** — the exporter records its own failures (`error-log/export`) so a failed share
  doesn't vanish silently.

Anywhere else can record an error with one call — no hook or React needed:

```ts
import { logError } from '@/shared/state/errorLogStore';
logError({ source: 'my-feature', error: e, severity: 'warning', context: { id } });
```

## UI
- **ErrorLogScreen** — newest-first list with a **severity filter** (All / Fatal / Errors /
  Warnings, each with a count). Each card is colour-coded by severity, shows the source, timestamp
  and message, and expands to reveal **context** and the **stack trace**. Per-error delete, a
  confirmed **Clear all**, and **Export** (shares the currently filtered set).
- **Export** writes a file to the document directory and opens the OS share sheet (expo-sharing),
  in either **Markdown** (human-readable report) or **JSON** (full records). Both native modules are
  loaded with dependency-tolerant dynamic imports, so the build/tests don't require them and the
  feature degrades to a no-op where sharing is unavailable (web/tests).

## model
- `shared/lib/errorLog.ts` — the **pure core** (unit-tested, under lint/typecheck scope):
  the `LoggedError` record, `normalizeError` (unknown thrown value → message + stack),
  `buildLoggedError`, and the `formatErrorsForExport` (Markdown) / `errorsToJson` renderers.
- `shared/state/errorLogStore.ts` — Zustand store **persisted** to `bolid.errors` via
  `shared/state/persistStorage`: `errors: LoggedError[]` plus `log`, `remove`, `clear`. Lives in
  `shared/state` so any feature can record without depending on another feature. Exposes the
  module-level `logError(...)` convenience (best-effort — never throws, mirrors to the console) and
  `installGlobalErrorHandlers()`.

## Retention
- **Capped at `MAX_ERRORS` (500)** — newest kept, oldest dropped, so the persisted file can't grow
  unbounded. Entries accumulate (newest first) until the cap or **Clear all**.

## Acceptance
- A connect failure, a fault-code read failure, or an AI-diagnose failure each add one entry with the
  matching `source`, alongside the feature's existing error message.
- An uncaught error / unhandled rejection is captured as a `global` / `unhandledRejection` entry.
- Entries persist across app restarts and render under the correct severity filter.
- Export produces a Markdown or JSON file and opens the share sheet; Clear all empties the list and
  the persisted file.
