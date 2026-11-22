import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { LICENSES_URL } from '@/shared/lib/appInfo';
import { LicensesScreen, LICENSES_PAGE } from './LicensesScreen';
import { THIRD_PARTY_LICENSES, type LicenseData } from '../model/licenses';

const SMALL: LicenseData = {
  schema: 'bolid.licenses.v1',
  app: 'bolid-tester',
  direct: ['alpha-lib'],
  packages: [
    {
      name: 'alpha-lib',
      version: '1.2.3',
      license: 'MIT',
      repository: 'https://github.com/example/alpha-lib',
      copyright: ['Copyright (c) 2024 Alpha Authors'],
      text: 't1',
    },
    {
      name: 'beta-lib',
      version: '0.1.0',
      license: 'ISC',
      repository: null,
      copyright: [],
      text: null,
    },
  ],
  texts: { t1: 'Permission is hereby granted, free of charge, to any person obtaining a copy' },
};

describe('LicensesScreen (plan 30)', () => {
  it('renders the generated notices: the count, the per-licence summary and the packages', () => {
    renderWithProviders(<LicensesScreen />);
    const n = THIRD_PARTY_LICENSES.packages.length;
    expect(screen.getByText(new RegExp(`built on ${n} open-source packages`))).toBeTruthy();
    expect(screen.getByTestId('licenses-summary').props.children).toMatch(/^MIT \d+/);
    // A page at a time; the rest behind Show more.
    const first = THIRD_PARTY_LICENSES.packages[0];
    expect(screen.getByText(first.name)).toBeTruthy();
    expect(screen.getByText(`Show ${n - LICENSES_PAGE} more`)).toBeTruthy();
  });

  it('filters by name and shows a package’s copyright and licence text on tap', () => {
    renderWithProviders(<LicensesScreen />);
    fireEvent.changeText(
      screen.getByLabelText('Filter the packages by name or licence'),
      'react-native-ble-plx',
    );
    const row = THIRD_PARTY_LICENSES.packages.find((p) => p.name === 'react-native-ble-plx');
    expect(row).toBeDefined();
    fireEvent.press(screen.getByTestId(`license-react-native-ble-plx@${row?.version}`));
    expect(screen.getByText(row?.copyright[0] ?? '')).toBeTruthy();
  });

  it('expands and collapses one package, and explains a package without a licence file', () => {
    renderWithProviders(<LicensesScreen data={SMALL} />);
    expect(screen.queryByText('Copyright (c) 2024 Alpha Authors')).toBeNull();
    fireEvent.press(screen.getByLabelText('alpha-lib 1.2.3, MIT'));
    expect(screen.getByText('Copyright (c) 2024 Alpha Authors')).toBeTruthy();
    expect(screen.getByText(/Permission is hereby granted/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('alpha-lib 1.2.3, MIT'));
    expect(screen.queryByText('Copyright (c) 2024 Alpha Authors')).toBeNull();

    fireEvent.press(screen.getByLabelText('beta-lib 0.1.0, ISC'));
    expect(screen.getByText(/ships no licence file; it is published under ISC/)).toBeTruthy();

    fireEvent.changeText(
      screen.getByLabelText('Filter the packages by name or licence'),
      'nothing',
    );
    expect(screen.getByText('No package matches.')).toBeTruthy();
  });

  it('links to the full list on GitHub', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderWithProviders(<LicensesScreen data={SMALL} />);
    fireEvent.press(screen.getByLabelText('Open the full licence list on GitHub'));
    expect(open).toHaveBeenCalledWith(LICENSES_URL);
    open.mockRestore();
  });
});
