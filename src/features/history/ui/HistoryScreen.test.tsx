import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useHistoryStore } from '@/shared/state/historyStore';
import { HistoryScreen } from './HistoryScreen';

const golf = { id: 'golf-plus-2009-20tdi', label: 'VW Golf Plus', vin: 'WVWZZZ1KZ9W903398' };

describe('HistoryScreen — report entries (plan 15)', () => {
  beforeEach(() => {
    const { addDtcCheck, addReportRun } = useHistoryStore.getState();
    addDtcCheck({
      vehicle: golf,
      milOn: false,
      stored: [{ code: 'P0299', description: 'Underboost' }],
      pending: [],
      permanent: [],
      monitorsComplete: null,
      monitorsTotal: null,
    });
    addReportRun({
      vehicle: golf,
      sections: ['faults', 'scan', 'maintenance'],
      format: 'pdf',
      fileName: 'bolid-report-WVWZZZ1KZ9W903398-20261109-0805.pdf',
    });
  });

  it('shows a report card with its format, sections and file name', () => {
    renderWithProviders(<HistoryScreen />);
    expect(screen.getByText(/Vehicle report ·/)).toBeTruthy();
    expect(screen.getByText('PDF')).toBeTruthy();
    expect(
      screen.getByText('Fault codes & readiness · Module scan · Maintenance due'),
    ).toBeTruthy();
    expect(screen.getByText('bolid-report-WVWZZZ1KZ9W903398-20261109-0805.pdf')).toBeTruthy();
  });

  it('the Reports filter shows only report entries', () => {
    renderWithProviders(<HistoryScreen />);
    expect(screen.getByText(/Fault-code check ·/)).toBeTruthy();

    fireEvent.press(screen.getByText('Reports'));
    expect(screen.queryByText(/Fault-code check ·/)).toBeNull();
    expect(screen.getByText(/Vehicle report ·/)).toBeTruthy();

    fireEvent.press(screen.getByText('Faults'));
    expect(screen.queryByText(/Vehicle report ·/)).toBeNull();
  });
});
