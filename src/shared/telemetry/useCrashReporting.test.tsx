/** The app-shell wiring of opt-in crash reports (plan 31): with the stored setting off (a fresh
 *  install) nothing is initialised and `logError` sends nothing; the Settings switch turns the
 *  reporter on and off without a restart; connection breadcrumbs follow the session; the connected
 *  car's VIN is masked in what is sent. The SDK is a double (no network). */
import { act, render, renderHook } from '@testing-library/react-native';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import type { SessionInfo } from '@/shared/obd-core/session/DiagnosticSession';
import {
  crashReportingReady,
  getCrashReportingStatus,
  setCrashReportingDsn,
  setCrashReportingModuleLoader,
} from './crashReporting';
import { CrashReportingHost, useCrashReporting } from './useCrashReporting';

const sdk = {
  init: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
  close: jest.fn(),
};

let seq = 0;
const msg = (s: string) => `${s} #${++seq}`;

beforeEach(() => {
  setCrashReportingDsn('https://key@o1.ingest.de.sentry.io/2');
  setCrashReportingModuleLoader(async () => sdk);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it('a fresh install (switch off) initialises nothing and sends nothing', async () => {
  expect(useSettingsStore.getState().crashReports).toBe(false);
  renderHook(() => useCrashReporting());
  await act(async () => {
    await crashReportingReady();
  });

  logError({ source: 'connection', error: new Error(msg('link lost')) });
  act(() => {
    useSessionStore.getState().setStatus('connecting');
  });

  expect(getCrashReportingStatus()).toBe('off');
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.captureException).not.toHaveBeenCalled();
  expect(sdk.addBreadcrumb).not.toHaveBeenCalled();
});

it('follows the Settings switch: on sends, off stops, on resumes without a restart', async () => {
  renderHook(() => useCrashReporting());

  await act(async () => {
    useSettingsStore.getState().setCrashReports(true);
    await crashReportingReady();
  });
  expect(sdk.init).toHaveBeenCalledTimes(1);
  logError({ source: 'connection', error: new Error(msg('on')) });
  expect(sdk.captureException).toHaveBeenCalledTimes(1);

  act(() => {
    useSettingsStore.getState().setCrashReports(false);
  });
  logError({ source: 'connection', error: new Error(msg('off')) });
  expect(sdk.captureException).toHaveBeenCalledTimes(1);
  expect(sdk.close).toHaveBeenCalledTimes(1);

  await act(async () => {
    useSettingsStore.getState().setCrashReports(true);
    await crashReportingReady();
  });
  logError({ source: 'connection', error: new Error(msg('on again')) });
  expect(sdk.captureException).toHaveBeenCalledTimes(2);
});

it('starts on at launch when the stored choice is on, with connection breadcrumbs and the VIN masked', async () => {
  useSettingsStore.setState({ crashReports: true });
  renderHook(() => useCrashReporting());
  await act(async () => {
    await crashReportingReady();
  });
  expect(getCrashReportingStatus()).toBe('on');

  act(() => {
    useSessionStore.getState().setStatus('connecting');
  });
  expect(sdk.addBreadcrumb).toHaveBeenCalledWith({
    category: 'connection',
    message: 'connecting',
    level: 'info',
  });

  // A hex-letters-only VIN the free-text rule would miss; known from the session, so masked.
  const vin = '1FADB40A1CF000001';
  act(() => {
    useSessionStore.setState({ info: { vin } as unknown as SessionInfo });
  });
  const beforeSend = sdk.init.mock.calls[0][0].beforeSend as (e: object) => { message: string };
  expect(beforeSend({ message: `car ${vin}` }).message).toBe('car ***00001');
});

it('CrashReportingHost renders nothing and wires the same switch (the root layout mounts it)', async () => {
  const view = render(<CrashReportingHost />);
  expect(view.toJSON()).toBeNull();

  await act(async () => {
    useSettingsStore.getState().setCrashReports(true);
    await crashReportingReady();
  });
  expect(getCrashReportingStatus()).toBe('on');
  view.unmount();
});
