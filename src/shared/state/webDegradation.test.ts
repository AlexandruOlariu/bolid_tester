/** Plan 28: in the browser, features that need the phone's file system or keystore degrade
 *  explicitly — a "Not available on web yet" toast for file imports / exports, and a memory-only
 *  AI key — instead of crashing or logging a warning per call. The web runtime is simulated with a
 *  fake `globalThis.document` (`isWebRuntime`). */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

// expo-secure-store resolves on web but every call rejects as unavailable.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => {
    throw new Error('The method or property SecureStore.getItemAsync is not available on web');
  }),
  setItemAsync: jest.fn(async () => {
    throw new Error('The method or property SecureStore.setItemAsync is not available on web');
  }),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { NOT_ON_WEB_YET, TOAST_MS, hideToast, showToast, useToastStore } from './toastStore';
import { loadExchangeModules } from './exchangeService';
import { useErrorLogStore } from './errorLogStore';
import { secureGetApiKey, secureSetApiKey } from './secureApiKey';
import { isWebRuntime } from '@/shared/lib/webRuntime';

const g = globalThis as { document?: unknown };

function asWeb(): void {
  g.document = { createElement: () => ({}) };
}

afterEach(() => {
  delete g.document;
  hideToast();
  jest.useRealTimers();
});

describe('toast store', () => {
  it('shows a message, replaces it with a newer one and hides it after the timeout', () => {
    jest.useFakeTimers();
    showToast('first');
    showToast('second');
    expect(useToastStore.getState().toast?.message).toBe('second');
    jest.advanceTimersByTime(TOAST_MS - 1);
    expect(useToastStore.getState().toast?.message).toBe('second');
    jest.advanceTimersByTime(1);
    expect(useToastStore.getState().toast).toBeNull();
  });

  it('hideToast dismisses at once', () => {
    showToast('x');
    hideToast();
    expect(useToastStore.getState().toast).toBeNull();
  });
});

describe('in the browser', () => {
  it('isWebRuntime follows the DOM', () => {
    expect(isWebRuntime()).toBe(false);
    asWeb();
    expect(isWebRuntime()).toBe(true);
  });

  it('a profile / label-pack file action shows "Not available on web yet" instead of failing', async () => {
    useErrorLogStore.setState({ errors: [] });
    await expect(loadExchangeModules('vehicle-select/exchange')).resolves.not.toBeNull();
    expect(useToastStore.getState().toast).toBeNull();

    asWeb();
    await expect(loadExchangeModules('vehicle-select/exchange')).resolves.toBeNull();
    expect(useToastStore.getState().toast?.message).toBe(NOT_ON_WEB_YET);
    expect(useErrorLogStore.getState().errors).toHaveLength(0);
  });

  it('the AI key stays in memory: the keystore is never called and nothing is logged', async () => {
    useErrorLogStore.setState({ errors: [] });
    asWeb();
    await expect(secureSetApiKey('openai', 'sk-test')).resolves.toBe(false);
    await expect(secureGetApiKey('openai')).resolves.toBeNull();
    expect(useErrorLogStore.getState().errors).toHaveLength(0);
  });
});
