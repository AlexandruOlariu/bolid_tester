/** Opt-in crash reporting (plan 31). **Off by default**: nothing leaves the phone until the user
 *  turns on Settings → Privacy → Send anonymous crash reports, and even then only when the build
 *  carries a DSN (`EXPO_PUBLIC_SENTRY_DSN`, set at build time from a secret, never committed) and
 *  `@sentry/react-native` is installed. Without either, every function here is a no-op.
 *
 *  - The SDK is loaded lazily through a variable import specifier (the repo's pattern for optional
 *    native modules) and initialised only when reporting is switched on; switching off closes it,
 *    switching on again re-initialises it without a restart.
 *  - Every JavaScript event passes `scrubEvent` (`@/shared/lib/scrub`) on the way out, and the
 *    `beforeSend` gate drops it while the switch is off, whatever the SDK queued. Native crashes
 *    (Java / Objective-C / NDK / ANR) are captured and sent by the native SDK without this
 *    scrubber; the privacy policy says so (docs/privacy-policy.md → Crash reports).
 *  - No tracing: `tracesSampleRate` is left unset (a number, even 0, turns on Sentry's tracing
 *    integrations, which add `sentry-trace` / `baggage` headers to every fetch, AI requests
 *    included) and `tracePropagationTargets` is empty as a second guard.
 *  - Only two breadcrumb kinds are kept: screen changes (`nav`) and connection status changes
 *    (`connection`). Never an adapter I/O line.
 *
 *  This module has no React Native or store imports, so `errorLogStore` can call `captureError`
 *  without an import cycle and the module runs in the Node test project. The React wiring (start,
 *  settings subscription, breadcrumbs, known VINs) is `useCrashReporting.ts`. See
 *  docs/features/settings.md → Privacy and docs/architecture.md → Telemetry. */
import { normalizeError, type ErrorSeverity, type LogErrorInput } from '@/shared/lib/errorLog';
import {
  scrubBreadcrumb,
  scrubEvent,
  type CrashBreadcrumb,
  type CrashEventLike,
} from '@/shared/lib/scrub';
import { APP_VERSION } from '@/shared/lib/appInfo';

/** The reporter's surface (plan 31). The module-level functions below are the one instance. */
export interface CrashReporter {
  init(dsn: string): Promise<void>;
  setEnabled(on: boolean): void;
  captureError(input: LogErrorInput): void;
  addBreadcrumb(category: string, message: string): void;
}

/** The slice of `@sentry/react-native` this module uses. */
export interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(
    error: unknown,
    context?: {
      level?: string;
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    },
  ): unknown;
  addBreadcrumb(breadcrumb: { category: string; message: string; level?: string }): void;
  close?(timeout?: number): unknown;
}

export type SentryLoader = () => Promise<SentryLike | null>;

/** Read at bundle time: Expo inlines `process.env.EXPO_PUBLIC_*`. Empty in dev builds and forks,
 *  which keeps the reporter a no-op. */
export const DSN: string = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();

/** - `unavailable`: no DSN in this build (dev, forks) — nothing can be sent.
 *  - `missing`: a DSN, but `@sentry/react-native` could not be loaded — nothing is sent.
 *  - `off`: available, switched off (the default) — nothing is sent.
 *  - `on`: initialised and switched on — scrubbed reports are sent. */
export type CrashReportingStatus = 'unavailable' | 'missing' | 'off' | 'on';

/** Error-log sources the crash SDK captures itself once initialised (its global error and
 *  unhandled-rejection handlers wrap `installGlobalErrorHandlers`'), so `captureError` skips them
 *  instead of sending each twice. */
const SDK_CAPTURED_SOURCES = new Set(['global', 'unhandledRejection']);

let dsnOverride: string | undefined;
let loaderOverride: SentryLoader | undefined;
/** The user's choice (Settings → Privacy). The `beforeSend` gate reads it. */
let wanted = false;
let sentry: SentryLike | null = null;
let initialised = false;
let moduleMissing = false;
let starting: Promise<void> | null = null;
let knownVins: string[] = [];

function dsn(): string {
  return (dsnOverride ?? DSN).trim();
}

async function defaultLoader(): Promise<SentryLike | null> {
  try {
    const mod = (await import('@sentry/react-native' as string)) as Partial<SentryLike>;
    return typeof mod.init === 'function' && typeof mod.captureException === 'function'
      ? (mod as SentryLike)
      : null;
  } catch {
    return null;
  }
}

/** True when this build can send crash reports at all (it carries a DSN). The Settings switch
 *  shows "Unavailable in this build" otherwise. */
export function isCrashReportingAvailable(): boolean {
  return dsn() !== '';
}

export function getCrashReportingStatus(): CrashReportingStatus {
  if (!isCrashReportingAvailable()) return 'unavailable';
  if (moduleMissing) return 'missing';
  return wanted && initialised ? 'on' : 'off';
}

/** The `Sentry.init` options. `enabled` is true because the SDK is only initialised once the user
 *  switched reporting on; the `beforeSend` gate still drops anything while the switch is off. */
export function crashReportingOptions(dsnValue: string): Record<string, unknown> {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  return {
    dsn: dsnValue,
    enabled: true,
    sendDefaultPii: false,
    attachStacktrace: true,
    attachScreenshot: false,
    attachViewHierarchy: false,
    maxBreadcrumbs: 30,
    // No `tracesSampleRate` (see the header): crash reports only, no tracing headers on requests.
    enableAutoPerformanceTracing: false,
    tracePropagationTargets: [],
    enableAutoSessionTracking: true,
    enableCaptureFailedRequests: false,
    release: APP_VERSION,
    environment: dev ? 'dev' : 'production',
    beforeSend: (event: CrashEventLike) => (wanted ? scrubEvent(event, { knownVins }) : null),
    beforeBreadcrumb: (b: CrashBreadcrumb) => scrubBreadcrumb(b, { knownVins }),
  };
}

async function ensureStarted(): Promise<void> {
  if (initialised || !wanted) return;
  if (starting) return starting;
  starting = (async () => {
    try {
      const value = dsn();
      if (!value) return;
      if (!sentry) sentry = await (loaderOverride ?? defaultLoader)();
      if (!sentry) {
        moduleMissing = true;
        return;
      }
      moduleMissing = false;
      // Switched off while the module was loading: stay uninitialised.
      if (!wanted) return;
      sentry.init(crashReportingOptions(value));
      initialised = true;
    } catch {
      // Best-effort: a failing init leaves reporting off, never crashes the app.
      initialised = false;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

/** Start at app launch with the stored choice. Without a DSN or the module, or with `enabled`
 *  false, nothing is loaded or initialised. Never rejects. */
export async function startCrashReporting(enabled: boolean): Promise<void> {
  wanted = enabled;
  if (!isCrashReportingAvailable()) return;
  if (wanted) await ensureStarted();
}

/** The Settings switch changed. On: initialise now (no restart). Off: the `beforeSend` gate closes
 *  at once and the SDK is closed, so later `captureError` calls send nothing. */
export function setCrashReportingEnabled(on: boolean): void {
  wanted = on;
  if (on) {
    void ensureStarted();
    return;
  }
  if (initialised && sentry) {
    initialised = false;
    try {
      void sentry.close?.();
    } catch {
      // Closing is best-effort; the gate already blocks every event.
    }
  }
}

/** Await an in-flight start (tests, and the Settings test button). */
export function crashReportingReady(): Promise<void> {
  return starting ?? Promise.resolve();
}

/** Forward an error-log entry (`logError`) to the crash service — only while reporting is on, never
 *  a `warning`, and not the uncaught errors the SDK captures itself. The message is scrubbed again
 *  by `beforeSend`. Never throws. */
export function captureError(input: LogErrorInput): void {
  try {
    if (!wanted || !initialised || !sentry) return;
    const severity: ErrorSeverity = input.severity ?? 'error';
    if (severity === 'warning') return;
    if (SDK_CAPTURED_SOURCES.has(input.source)) return;
    const error =
      input.error instanceof Error
        ? input.error
        : new Error(input.message ?? normalizeError(input.error).message);
    sentry.captureException(error, {
      level: severity === 'fatal' ? 'fatal' : 'error',
      tags: { source: input.source, severity },
      ...(input.context ? { extra: { ...input.context } } : {}),
    });
  } catch {
    // Reporting must never break the caller (logError is called from catch blocks).
  }
}

/** A `nav` (screen path) or `connection` (status) breadcrumb; any other category is dropped by
 *  `beforeBreadcrumb`. A no-op while reporting is off. */
export function addCrashBreadcrumb(category: 'nav' | 'connection', message: string): void {
  try {
    if (!wanted || !initialised || !sentry) return;
    sentry.addBreadcrumb({ category, message, level: 'info' });
  } catch {
    // Best-effort.
  }
}

/** VINs the app knows (the connected car's, the garage's), masked in every report even where the
 *  free-text VIN rule would miss them. */
export function setCrashScrubVins(vins: readonly string[]): void {
  knownVins = vins.filter((v) => typeof v === 'string' && v.length === 17);
}

/** A sample VIN, adapter address and server address the test report carries, so the received
 *  event shows the scrubbing worked (`***03398`, `<device-id>`, `<url>`). */
export const TEST_REPORT_MESSAGE =
  'Test crash report from Settings. Sample VIN WVWZZZ1KZ9W903398, adapter AA:BB:CC:DD:EE:FF, server http://192.168.1.20:1234/v1';

/** Settings → Developer → Send test crash report. True when an event was handed to the SDK
 *  (reporting on); false otherwise — nothing is sent. */
export function sendTestCrashReport(): boolean {
  if (getCrashReportingStatus() !== 'on' || !sentry) return false;
  try {
    sentry.captureException(new Error(TEST_REPORT_MESSAGE), {
      level: 'error',
      tags: { source: 'settings/test', severity: 'error' },
    });
    return true;
  } catch {
    return false;
  }
}

/** The one `CrashReporter` instance, for callers that prefer an object. */
export const crashReporter: CrashReporter = {
  init: async (dsnValue) => {
    dsnOverride = dsnValue;
    await startCrashReporting(true);
  },
  setEnabled: setCrashReportingEnabled,
  captureError,
  addBreadcrumb: (category, message) => {
    if (category === 'nav' || category === 'connection') addCrashBreadcrumb(category, message);
  },
};

/** Tests: replace the DSN (undefined = the build's own). */
export function setCrashReportingDsn(value: string | undefined): void {
  dsnOverride = value;
}

/** Tests: replace the SDK loader (undefined = the real `@sentry/react-native` import). */
export function setCrashReportingModuleLoader(loader: SentryLoader | undefined): void {
  loaderOverride = loader;
  sentry = null;
  moduleMissing = false;
}

/** Tests: forget all state (choice, SDK, overrides). */
export function resetCrashReporting(): void {
  dsnOverride = undefined;
  loaderOverride = undefined;
  wanted = false;
  sentry = null;
  initialised = false;
  moduleMissing = false;
  starting = null;
  knownVins = [];
}
