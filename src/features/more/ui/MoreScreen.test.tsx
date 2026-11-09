import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { setMockWindow, TABLET_WINDOW } from '@test/mocks/window';
import { MoreScreen } from './MoreScreen';

/** Every row, by section (plan 07). "Check for updates" is the last Tools row. */
const SECTIONS: Record<string, string[]> = {
  diagnose: ['Diagnose (AI)', 'Used-car inspection', 'History', 'Vehicle report', 'Sensor tests'],
  drive: ['Charts', 'Performance', 'Trips', 'Alerts'],
  ownership: [
    'Maintenance log',
    'Battery & charging',
    'DPF / regen',
    'VIN decoder',
    'Notifications',
  ],
  workshop: [
    'Module scan',
    'Adaptations',
    'Routines & output tests',
    'Coding',
    'Service reset',
    'Bus sniffer',
  ],
  tools: ['Adapter health', 'Backup & restore', 'Error log', 'Check for updates'],
};
const ALL_TITLES = Object.values(SECTIONS).flat();

/** A button whose accessible name starts with `title.` (rows are labelled "Title. Subtitle"). */
function entryName(title: string): RegExp {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\. `);
}

describe('MoreScreen', () => {
  it('renders the five sections with every entry as a labelled button', () => {
    renderWithProviders(<MoreScreen />);

    expect(screen.getByText('More')).toBeTruthy();
    for (const [id, titles] of Object.entries(SECTIONS)) {
      const section = within(screen.getByTestId(`more-section-${id}`));
      for (const title of titles) {
        expect(section.getByRole('button', { name: entryName(title) })).toBeTruthy();
      }
    }
    expect(screen.getAllByRole('button')).toHaveLength(ALL_TITLES.length);
    expect(screen.queryByText('Sensor readings')).toBeNull(); // folded into Live (plan 07)
  });

  it('marks only the Workshop rows experimental and shows the Workshop blurb', () => {
    renderWithProviders(<MoreScreen />);

    expect(screen.getAllByText('experimental')).toHaveLength(SECTIONS.workshop.length);
    expect(screen.getByRole('button', { name: /^Coding\. .*\. Experimental$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trips. Record & export live data' })).toBeTruthy();
    expect(screen.getByText(/CAN cars only; addresses are confirmed per car/)).toBeTruthy();
  });

  it('search filters the rows: "cod" leaves only Coding, in Workshop', () => {
    renderWithProviders(<MoreScreen />);

    fireEvent.changeText(screen.getByLabelText('Search tools'), 'cod');

    expect(screen.getAllByRole('button')).toHaveLength(1);
    const workshop = within(screen.getByTestId('more-section-workshop'));
    expect(workshop.getByRole('button', { name: entryName('Coding') })).toBeTruthy();
    expect(workshop.getByText('experimental')).toBeTruthy();
    expect(screen.queryByTestId('more-section-ownership')).toBeNull();
    expect(screen.queryByText('VIN decoder')).toBeNull();

    // A query that matches nothing says so; clearing it brings every row back.
    fireEvent.changeText(screen.getByLabelText('Search tools'), 'zzz');
    expect(screen.getByText('No tools match “zzz”.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    fireEvent.changeText(screen.getByLabelText('Search tools'), '');
    expect(screen.getAllByRole('button')).toHaveLength(ALL_TITLES.length);
  });

  it('tapping Error log opens /error-log', () => {
    renderWithProviders(<MoreScreen />);

    fireEvent.press(screen.getByRole('button', { name: entryName('Error log') }));
    expect(mockPush).toHaveBeenCalledWith('/error-log');
  });

  it('tapping Backup & restore opens /backup', () => {
    renderWithProviders(<MoreScreen />);

    fireEvent.press(screen.getByRole('button', { name: entryName('Backup & restore') }));
    expect(mockPush).toHaveBeenCalledWith('/backup');
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
    expect(mockPush).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('lays each section out in two columns on a tablet (plan 21)', () => {
    setMockWindow(TABLET_WINDOW);
    renderWithProviders(<MoreScreen />);

    for (const [id, titles] of Object.entries(SECTIONS)) {
      const cells = screen.getAllByTestId(`more-grid-${id}-cell`);
      expect(cells).toHaveLength(titles.length);
      expect(cells[0]).toHaveStyle({ flexBasis: '49%' });
      expect(within(cells[0]).getByRole('button', { name: entryName(titles[0]) })).toBeTruthy();
    }
  });

  it('keeps one column on a phone in portrait', () => {
    renderWithProviders(<MoreScreen />);
    expect(screen.queryByTestId('more-grid-diagnose')).toBeNull();
    expect(screen.queryAllByTestId(/^more-grid-.*-cell$/)).toHaveLength(0);
  });
});
