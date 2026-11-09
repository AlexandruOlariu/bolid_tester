/** Trips screen per-car filter (plan 06): the chips filter the saved trips, and a filter whose car
 *  loses its last trip falls back to "All cars" instead of leaving an empty, unclearable list. */
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useTripStore, type TripSummary } from '../model/tripStore';
import { TripScreen } from './TripScreen';

function trip(id: string, startedAt: number, vehicleId: string): TripSummary {
  return {
    header: {
      id,
      startedAt,
      endedAt: startedAt + 60_000,
      profileId: vehicleId,
      vin: null,
      protocol: 'AUTO',
    },
    stats: { durationMs: 60_000, sampleCount: Number(id), distanceKm: null, max: {} },
    markerCount: 0,
    vehicleId,
  };
}

// Sample counts double as row ids: "· 11 samples" is the Punto trip, 21 / 22 the Golf ones.
const PUNTO = trip('11', Date.UTC(2026, 10, 1), 'fiat-punto-2008-12');
const GOLF_A = trip('21', Date.UTC(2026, 10, 2), 'golf-plus-2009-20tdi');
const GOLF_B = trip('22', Date.UTC(2026, 10, 3), 'golf-plus-2009-20tdi');

beforeEach(() => {
  useTripStore.setState({ trips: [PUNTO, GOLF_A, GOLF_B] });
});

describe('TripScreen per-car filter', () => {
  it('filters by car and falls back to all trips when the filtered car loses its last trip', async () => {
    renderWithProviders(<TripScreen />);
    expect(screen.getByText('All cars (3)')).toBeTruthy();
    expect(screen.getAllByText(/ samples$/)).toHaveLength(3);

    fireEvent.press(screen.getByText(/\(1\)$/));
    expect(screen.getByText(/· 11 samples$/)).toBeTruthy();
    expect(screen.queryByText(/· 21 samples$/)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Delete'));
    });

    // One car left: no chip row, and the remaining trips are listed instead of an empty filter.
    expect(useTripStore.getState().trips).toHaveLength(2);
    expect(screen.queryByText(/^All cars/)).toBeNull();
    expect(screen.getByText(/· 21 samples$/)).toBeTruthy();
    expect(screen.getByText(/· 22 samples$/)).toBeTruthy();
  });
});
