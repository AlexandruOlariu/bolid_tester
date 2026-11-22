/** Saved-scan compare deep link (plan 16): `/module-scan?after=<id>&before=<id>` from the History
 *  timeline seeds the Compare pickers and shows that pair's diff, then clears the params. */
import React from 'react';
import { act, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockSetParams, setMockSearchParams } from '@test/mocks/router';
import type { HistoryVehicle } from '@/shared/state/historyStore';
import { useScanHistoryStore, type SavedScan } from '../model/scanHistoryStore';
import { ScanHistorySection } from './ScanHistorySection';

const GOLF: HistoryVehicle = { id: 'golf-plus-2009-20tdi', label: 'VW Golf Plus', vin: null };
const PUNTO: HistoryVehicle = { id: 'fiat-punto-2008-12', label: 'Fiat Punto', vin: null };
const T = Date.UTC(2026, 10, 9, 8);

function scan(
  id: string,
  ts: number,
  vehicle: HistoryVehicle,
  fault: boolean,
  address = '01',
): SavedScan {
  return {
    id,
    ts,
    vehicle,
    protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
    tp20: null,
    modules: [
      {
        address,
        name: 'Engine',
        state: 'ok',
        dtcs: fault
          ? [
              {
                sae: 'P0299',
                display: 'P0299 00',
                vagCode: '00665',
                description: 'Turbocharger underboost',
                status: 0x09,
              },
            ]
          : [],
      },
    ],
  };
}

beforeEach(() => {
  // Newest first: a Punto scan, then the Golf after the repair, then the Golf with the fault.
  useScanHistoryStore.setState({
    scans: [
      scan('punto-1', T + 3_600_000, PUNTO, false, '02'),
      scan('golf-2', T + 1_800_000, GOLF, false),
      scan('golf-1', T, GOLF, true),
    ],
  });
});

describe('ScanHistorySection compare', () => {
  it('defaults to the latest scan against the previous one', () => {
    renderWithProviders(<ScanHistorySection />);
    // Punto (02 only) vs Golf (01 only): a module added and one removed, no cleared fault.
    expect(
      screen.getByText(/0 appeared · 0 cleared · 0 changed · 1 added · 1 removed/),
    ).toBeTruthy();
    expect(screen.queryByText(/cleared · P0299 00/)).toBeNull();
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('a timeline deep link pre-selects Before / After and shows the cleared fault', () => {
    setMockSearchParams({ after: 'golf-2', before: 'golf-1' });
    renderWithProviders(<ScanHistorySection />);
    expect(
      screen.getByText(/0 appeared · 1 cleared · 1 changed · 0 added · 0 removed/),
    ).toBeTruthy();
    expect(
      screen.getByText(/cleared · P0299 00 \(VAG 00665\) — Turbocharger underboost/),
    ).toBeTruthy();
    // The params are consumed, so the same link works again after a manual change.
    expect(mockSetParams).toHaveBeenCalledWith({ before: undefined, after: undefined });
  });

  it('an After-only link compares against the same car’s previous scan', () => {
    setMockSearchParams({ after: 'golf-2' });
    renderWithProviders(<ScanHistorySection />);
    expect(
      screen.getByText(/0 appeared · 1 cleared · 1 changed · 0 added · 0 removed/),
    ).toBeTruthy();
  });

  it('a car’s first scan has no baseline — never another car’s scan or itself', () => {
    setMockSearchParams({ after: 'punto-1' });
    renderWithProviders(<ScanHistorySection />);
    expect(screen.getByText('No earlier scan of this car — pick a baseline above.')).toBeTruthy();
    expect(screen.queryByText(/appeared ·/)).toBeNull();
    expect(screen.queryByText('Pick two different scans to compare.')).toBeNull();
  });

  it('a later After-only link on the still-mounted tab drops the earlier Before', () => {
    // Stands in for the navigator re-rendering the hidden tab when a new link arrives.
    let relink: () => void = () => undefined;
    function Tab() {
      const [, setN] = React.useState(0);
      relink = () => setN((n) => n + 1);
      return <ScanHistorySection />;
    }
    setMockSearchParams({ after: 'golf-2', before: 'golf-1' });
    renderWithProviders(<Tab />);
    expect(screen.getByText(/1 cleared/)).toBeTruthy();
    // The Golf's first scan: no earlier Golf scan, so Before is emptied rather than kept.
    setMockSearchParams({ after: 'golf-1' });
    act(() => relink());
    expect(screen.getByText('No earlier scan of this car — pick a baseline above.')).toBeTruthy();
    expect(screen.queryByText(/appeared ·/)).toBeNull();
  });
});
