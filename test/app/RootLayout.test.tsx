/** The root tab layout (`src/app/_layout.tsx`). Lives under test/ because expo-router would treat a
 *  `*.test.tsx` inside src/app as a route. `Tabs` is the stand-in from test/mocks/router.ts; the
 *  headless EngineHost (poll loop, alerts) and the animated splash are not under test here. */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import RootLayout from '@/app/_layout';

jest.mock('@/features/engine-host', () => ({ EngineHost: () => null }));
jest.mock('@/shared/ui/AppSplash', () => ({ AppSplash: () => null }));

/** The seven bottom tabs, in order: route file → tab title. */
const TABS: [string, string][] = [
  ['index', 'Connect'],
  ['vehicle', 'Vehicle'],
  ['dashboard', 'Live'],
  ['faults', 'Faults'],
  ['info', 'Info'],
  ['settings', 'Settings'],
  ['more', 'More'],
];

const APP_DIR = path.join(__dirname, '..', '..', 'src', 'app');

describe('RootLayout', () => {
  it('shows the seven tabs with their titles, in order', () => {
    render(<RootLayout />);

    const bar = screen.getByTestId('tabs-root');
    const visible = within(bar)
      .queryAllByTestId(/^tab-/)
      .map((el) => [String(el.props.testID).slice(4), el.props.children]);
    expect(visible).toEqual(TABS);
  });

  it('registers every route file, hiding everything but the seven tabs', () => {
    render(<RootLayout />);

    const routes = fs
      .readdirSync(APP_DIR)
      .filter((f) => f.endsWith('.tsx') && !f.startsWith('_'))
      .map((f) => f.replace(/\.tsx$/, ''));
    const tabRoutes = new Set(TABS.map(([route]) => route));
    for (const route of routes) {
      const id = tabRoutes.has(route) ? `tab-${route}` : `hidden-${route}`;
      expect({ route, registered: screen.queryByTestId(id) !== null }).toEqual({
        route,
        registered: true,
      });
    }
  });
});
