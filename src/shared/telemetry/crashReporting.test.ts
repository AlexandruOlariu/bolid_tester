/** Opt-in crash reporting (plan 31): nothing is loaded, initialised or sent while the switch is off,
 *  without a DSN or without the SDK; with a mocked SDK, `init` runs once per switch-on, errors go
 *  out only while on (never warnings), and every event passes the scrubber.
 *
 *  `logError` pulls in errorLogStore -> persistStorage -> expo-file-system (ESM, not transformed for
 *  the node test env), so the file system is a no-op mock. The real `@sentry/react-native` import is
 *  mocked to throw MODULE_NOT_FOUND, so the default loader's "module missing" path runs for real;
 *  the other tests inject an SDK double with `setCrashReportingModuleLoader`. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

jest.mock('@sentry/react-native', () => {
  throw Object.assign(new Error("Cannot find module '@sentry/react-native'"), {
    code: 'MODULE_NOT_FOUND',
  });
});

import { logError } from '@/shared/state/errorLogStore';
import {
  TEST_REPORT_MESSAGE,
  captureError,
  crashReportingReady,
  getCrashReportingStatus,
  isCrashReportingAvailable,
  resetCrashReporting,
  sendTestCrashReport,
  setCrashReportingDsn,
  setCrashReportingEnabled,
  setCrashReportingModuleLoader,
  setCrashScrubVins,
  startCrashReporting,
  type SentryLike,
} from './crashReporting';

const DSN = 'https://publickey@o1.ingest.de.sentry.io/2';
const VIN = 'WVWZZZ1KZ9W903398';

interface FakeSentry extends SentryLike {
  init: jest.Mock;
  captureException: jest.Mock;
  addBreadcrumb: jest.Mock;
  close: jest.Mock;
}

function fakeSentry(): FakeSentry {
  return {
    init: jest.fn(),
    captureException: jest.fn(),
    addBreadcrumb: jest.fn(),
    close: jest.fn(),
  };
}

/** The options of the n-th `init` call. */
function initOptions(sdk: FakeSentry, n = 0): Record<string, any> {
  return sdk.init.mock.calls[n][0] as Record<string, any>;
}

let seq = 0;
/** A unique message, so logError's 2-second dedup never swallows a call. */
const msg = (s: string) => `${s} #${++seq}`;

beforeEach(() => {
  resetCrashReporting();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('without a DSN (dev builds, forks)', () => {
  it('is unavailable, loads nothing and sends nothing even when switched on', async () => {
    setCrashReportingDsn('');
    const sdk = fakeSentry();
    const loader = jest.fn(async () => sdk);
    setCrashReportingModuleLoader(loader);

    await expect(startCrashReporting(true)).resolves.toBeUndefined();
    setCrashReportingEnabled(true);
    await crashReportingReady();
    expect(() => captureError({ source: 'test', error: new Error('boom') })).not.toThrow();
    logError({ source: 'test', error: new Error(msg('boom')) });

    expect(isCrashReportingAvailable()).toBe(false);
    expect(getCrashReportingStatus()).toBe('unavailable');
    expect(loader).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(sendTestCrashReport()).toBe(false);
  });
});

describe('with a DSN but no SDK installed', () => {
  it('the real import fails with MODULE_NOT_FOUND: no throw, status missing, nothing sent', async () => {
    setCrashReportingDsn(DSN);
    await expect(startCrashReporting(true)).resolves.toBeUndefined();
    expect(getCrashReportingStatus()).toBe('missing');
    expect(() => captureError({ source: 'test', error: new Error('boom') })).not.toThrow();
    expect(() => logError({ source: 'test', error: new Error(msg('boom')) })).not.toThrow();
    expect(sendTestCrashReport()).toBe(false);
  });
});

describe('with a DSN and the SDK', () => {
  let sdk: FakeSentry;
  let loader: jest.Mock;

  beforeEach(() => {
    setCrashReportingDsn(DSN);
    sdk = fakeSentry();
    loader = jest.fn(async () => sdk);
    setCrashReportingModuleLoader(loader);
  });

  it('switched off (the default): nothing is loaded or initialised, and logError sends nothing', async () => {
    await startCrashReporting(false);
    logError({ source: 'connection', error: new Error(msg('link lost')) });
    logError({ source: 'render', error: new Error(msg('bad screen')), severity: 'fatal' });
    captureError({ source: 'test', error: new Error('direct') });

    expect(getCrashReportingStatus()).toBe('off');
    expect(loader).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(sdk.addBreadcrumb).not.toHaveBeenCalled();
    expect(sendTestCrashReport()).toBe(false);
  });

  it('switched on: init once with the privacy options', async () => {
    await startCrashReporting(true);
    await startCrashReporting(true);
    setCrashReportingEnabled(true);
    await crashReportingReady();

    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(getCrashReportingStatus()).toBe('on');
    expect(initOptions(sdk)).toMatchObject({
      dsn: DSN,
      enabled: true,
      sendDefaultPii: false,
      attachStacktrace: true,
      attachScreenshot: false,
      attachViewHierarchy: false,
      maxBreadcrumbs: 30,
      enableAutoPerformanceTracing: false,
      tracePropagationTargets: [],
      enableAutoSessionTracking: true,
      environment: 'production',
    });
    // Any number, even 0, turns on Sentry's tracing (and trace headers on every fetch).
    expect(initOptions(sdk)).not.toHaveProperty('tracesSampleRate');
    expect(typeof initOptions(sdk).beforeSend).toBe('function');
    expect(typeof initOptions(sdk).beforeBreadcrumb).toBe('function');
  });

  it('logError sends errors and fatals while on, never warnings or what the SDK captures itself', async () => {
    await startCrashReporting(true);

    logError({ source: 'connection', error: new Error(msg('link lost')) });
    logError({ source: 'render', error: msg('bad screen'), severity: 'fatal' });
    logError({ source: 'secure-store', error: new Error(msg('keystore')), severity: 'warning' });
    logError({ source: 'global', error: new Error(msg('uncaught')), severity: 'fatal' });
    logError({ source: 'unhandledRejection', error: new Error(msg('rejected')) });

    expect(sdk.captureException).toHaveBeenCalledTimes(2);
    const [err1, ctx1] = sdk.captureException.mock.calls[0];
    expect(err1).toBeInstanceOf(Error);
    expect(ctx1).toMatchObject({
      level: 'error',
      tags: { source: 'connection', severity: 'error' },
    });
    const [err2, ctx2] = sdk.captureException.mock.calls[1];
    expect((err2 as Error).message).toMatch(/^bad screen/);
    expect(ctx2).toMatchObject({ level: 'fatal', tags: { source: 'render', severity: 'fatal' } });
  });

  it('switching off stops sending at once; switching on again resumes without a restart', async () => {
    await startCrashReporting(true);
    const beforeSend = initOptions(sdk).beforeSend as (e: object) => object | null;

    setCrashReportingEnabled(false);
    expect(sdk.close).toHaveBeenCalledTimes(1);
    expect(getCrashReportingStatus()).toBe('off');
    logError({ source: 'connection', error: new Error(msg('after off')) });
    expect(sdk.captureException).not.toHaveBeenCalled();
    // Anything the SDK still had queued is dropped by the gate.
    expect(beforeSend({ message: 'queued' })).toBeNull();

    setCrashReportingEnabled(true);
    await crashReportingReady();
    expect(sdk.init).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledTimes(1); // the module is loaded once
    logError({ source: 'connection', error: new Error(msg('after on')) });
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
  });

  it('switched off while the SDK is still loading: it never initialises', async () => {
    const start = startCrashReporting(true);
    setCrashReportingEnabled(false);
    await start;
    expect(sdk.init).not.toHaveBeenCalled();
    expect(getCrashReportingStatus()).toBe('off');
  });

  it('beforeSend scrubs the event: VIN, known VIN, device id, URL, e-mail, user, device name', async () => {
    setCrashScrubVins(['1FADB40A1CF000001']);
    await startCrashReporting(true);
    const beforeSend = initOptions(sdk).beforeSend as (e: object) => Record<string, any>;
    const out = beforeSend({
      message: `VIN ${VIN} at AA:BB:CC:DD:EE:FF via http://192.168.1.20:1234/v1 from owner@example.com`,
      exception: { values: [{ type: 'Error', value: 'known 1FADB40A1CF000001 failed' }] },
      user: { id: 'x', email: 'owner@example.com', ip_address: '1.2.3.4' },
      contexts: { device: { name: "Alex's phone", model: 'Pixel 7' }, os: { name: 'Android' } },
      tags: { source: 'connection', deviceName: 'OBDII' },
    });
    expect(out.message).toBe('VIN ***03398 at <device-id> via <url> from <email>');
    expect(out.exception.values[0].value).toBe('known ***00001 failed');
    expect(out).not.toHaveProperty('user');
    expect(out.contexts).toEqual({ device: { model: 'Pixel 7' }, os: { name: 'Android' } });
    expect(out.tags).toEqual({ source: 'connection' });
  });

  it('beforeBreadcrumb keeps only nav / connection breadcrumbs', async () => {
    await startCrashReporting(true);
    const beforeBreadcrumb = initOptions(sdk).beforeBreadcrumb as (b: object) => object | null;
    expect(beforeBreadcrumb({ category: 'console', message: '> 0100' })).toBeNull();
    expect(beforeBreadcrumb({ category: 'fetch', data: { url: 'http://10.0.0.2' } })).toBeNull();
    expect(beforeBreadcrumb({ category: 'nav', message: '/faults' })).toEqual({
      category: 'nav',
      message: '/faults',
    });
  });

  it('the test report is handed to the SDK only while on, with the sample identifiers', async () => {
    await startCrashReporting(false);
    expect(sendTestCrashReport()).toBe(false);
    setCrashReportingEnabled(true);
    await crashReportingReady();
    expect(sendTestCrashReport()).toBe(true);
    const [err] = sdk.captureException.mock.calls[0];
    expect((err as Error).message).toBe(TEST_REPORT_MESSAGE);
    const beforeSend = initOptions(sdk).beforeSend as (e: object) => Record<string, any>;
    const sent = beforeSend({ exception: { values: [{ value: TEST_REPORT_MESSAGE }] } });
    expect(sent.exception.values[0].value).toBe(
      'Test crash report from Settings. Sample VIN ***03398, adapter <device-id>, server <url>',
    );
  });

  it('a failing init leaves reporting off and never throws', async () => {
    sdk.init.mockImplementation(() => {
      throw new Error('native module not linked');
    });
    await expect(startCrashReporting(true)).resolves.toBeUndefined();
    expect(getCrashReportingStatus()).toBe('off');
    logError({ source: 'connection', error: new Error(msg('x')) });
    expect(sdk.captureException).not.toHaveBeenCalled();
  });
});
