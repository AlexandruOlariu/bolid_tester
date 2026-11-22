/** Accessibility sweep over every route screen (plan 20, docs/accessibility.md). Each screen in
 *  src/app is rendered — a new route is picked up automatically — once disconnected and once on the
 *  simulator, and `a11yProblems` (test/a11y.ts) must find nothing: every pressable named, every text
 *  input labelled, every switch / radio with a checked state. Some controls only exist after a tap
 *  (Live → Customize, Settings → Developer & simulator → Custom…) or with data (an error-log entry), so those
 *  states get their own cases. */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { a11yProblems } from '@test/a11y';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';

// Thirty-odd screens, each rendered twice. Loading the route modules is paid once in `beforeAll`
// (below), so no single case carries it.
jest.setTimeout(30000);

const APP_DIR = path.resolve(__dirname, '../../src/app');
const ROUTES = fs
  .readdirSync(APP_DIR)
  .filter((f) => f.endsWith('.tsx') && !f.startsWith('_'))
  .map((f) => f.replace(/\.tsx$/, ''))
  .sort();

function routeComponent(route: string): React.ComponentType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- one module per route file
  const mod = require(path.join(APP_DIR, `${route}.tsx`)) as { default: React.ComponentType };
  return mod.default;
}

async function renderRoute(route: string) {
  const Route = routeComponent(route);
  renderWithProviders(<Route />);
  // Let mount effects (store reads, async status checks) settle.
  await act(async () => {
    await Promise.resolve();
  });
}

const problems = () => a11yProblems(screen.root);

// Warm the module registry: the first `require` of the routes loads every feature, store and
// Tamagui component (about 9 s alone, far more under a parallel `npm test`). Without this the first
// route case pays it all against the per-test timeout and fails when the machine is busy.
beforeAll(() => {
  for (const route of ROUTES) routeComponent(route);
}, 180000);

describe('every route screen: names, labels, states', () => {
  it('finds the route files', () => {
    expect(ROUTES).toEqual(expect.arrayContaining(['index', 'dashboard', 'faults', 'settings']));
    expect(ROUTES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(ROUTES)('%s — disconnected', async (route) => {
    await renderRoute(route);
    expect(problems()).toEqual([]);
  });

  it.each(ROUTES)('%s — on the simulator with stored codes', async (route) => {
    await connectSimulator({ injectedDtcs: ['P0299', 'P0401'] });
    await renderRoute(route);
    expect(problems()).toEqual([]);
  });
});

describe('controls that appear after a tap or with data', () => {
  it('Live → Customize: the reorder / hide icon buttons are named', async () => {
    await connectSimulator();
    await renderRoute('dashboard');
    fireEvent.press(screen.getByText('Customize'));
    expect(screen.getByRole('button', { name: 'Move RPM down' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide RPM' })).toBeTruthy();
    expect(problems()).toEqual([]);
  });

  it('Settings → Developer & simulator (simulator source, custom codes)', async () => {
    await renderRoute('settings-developer');
    fireEvent.press(screen.getByText('Simulator (no car)'));
    fireEvent.press(screen.getByText('Custom…'));
    expect(problems()).toEqual([]);
  });

  it('Coding on a CAN car with coding modules: the raw bits and mask steppers are named', async () => {
    await connectSimulator();
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await renderRoute('coding');
    const bits = screen.getAllByRole('switch', { name: /^Byte 0 bit \d$/ });
    expect(bits).toHaveLength(8);
    expect(bits[0].props.accessibilityState).toEqual(
      expect.objectContaining({ checked: expect.any(Boolean) }),
    );
    expect(problems()).toEqual([]);
  });

  it('Error log with an entry: the delete icon button is named', async () => {
    act(() => {
      useErrorLogStore.getState().log({ source: 'ble/scan', error: new Error('Scan failed') });
    });
    await renderRoute('error-log');
    expect(screen.getByRole('button', { name: 'Delete error: ble/scan' })).toBeTruthy();
    expect(problems()).toEqual([]);
  });
});
