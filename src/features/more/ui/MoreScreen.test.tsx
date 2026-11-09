import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { MoreScreen } from './MoreScreen';

const ENTRY_TITLES = [
  'Diagnose (AI)',
  'History',
  'Vehicle report',
  'Used-car inspection',
  'DPF / regen',
  'Battery & charging',
  'Adapter health',
  'VIN decoder',
  'Maintenance log',
  'Charts',
  'Performance',
  'Trips',
  'Alerts',
  'Sensor readings',
  'Sensor tests',
  'Module scan',
  'Service reset',
  'Coding',
  'Adaptations',
  'Routines & output tests',
  'Notifications',
  'Bus sniffer',
  'Error log',
];

/** A button whose accessible name starts with `title.` (rows are labelled "Title. Subtitle"). */
function entryName(title: string): RegExp {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\. `);
}

describe('MoreScreen', () => {
  it('renders every entry as a labelled button', () => {
    renderWithProviders(<MoreScreen />);

    expect(screen.getByText('More')).toBeTruthy();
    for (const title of ENTRY_TITLES) {
      expect(screen.getByRole('button', { name: entryName(title) })).toBeTruthy();
    }
    // …plus "Check for updates".
    expect(screen.getAllByRole('button')).toHaveLength(ENTRY_TITLES.length + 1);
  });

  it('tapping Error log opens /error-log', () => {
    renderWithProviders(<MoreScreen />);

    fireEvent.press(screen.getByRole('button', { name: entryName('Error log') }));
    expect(mockPush).toHaveBeenCalledWith('/error-log');
  });

  it('tapping Vehicle report opens /report', () => {
    renderWithProviders(<MoreScreen />);

    fireEvent.press(screen.getByRole('button', { name: entryName('Vehicle report') }));
    expect(mockPush).toHaveBeenCalledWith('/report');
  });

  it('"Check for updates" reports OTA as unavailable in a build without updates', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderWithProviders(<MoreScreen />);

    fireEvent.press(screen.getByRole('button', { name: entryName('Check for updates') }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Updates unavailable', expect.any(String)),
    );
    alert.mockRestore();
  });
});
