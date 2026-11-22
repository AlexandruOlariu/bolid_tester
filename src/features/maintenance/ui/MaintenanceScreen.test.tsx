/** Per-car logbook on screen (plan 06): an entry logged while car A is active is not shown for car
 *  B, and switching back shows it again with A's odometer. */
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useMaintenanceStore } from '../model/maintenanceStore';
import { MaintenanceScreen } from './MaintenanceScreen';

function selectCar(id: string) {
  act(() => {
    useVehicleStore.getState().select(id);
  });
}

describe('MaintenanceScreen', () => {
  it('keeps one logbook per car', () => {
    selectCar('golf-plus-2009-20tdi');
    renderWithProviders(<MaintenanceScreen />);
    expect(screen.getByText(/VW Golf Plus 2009/)).toBeTruthy();
    // Nothing logged yet: every item has no history.
    expect(screen.getAllByText('no history yet').length).toBe(8);

    fireEvent.changeText(screen.getByPlaceholderText('e.g. 215000'), '215000');
    fireEvent.press(screen.getByText('Save'));
    fireEvent.press(screen.getByText(/today/));
    expect(screen.getAllByText('no history yet').length).toBe(7);
    expect(
      useMaintenanceStore.getState().byVehicle['id:golf-plus-2009-20tdi'].entries,
    ).toHaveLength(1);

    // Car B: an empty logbook and an empty odometer field.
    selectCar('fiat-punto-2008-12');
    expect(screen.getByText(/Fiat Grande Punto/)).toBeTruthy();
    expect(screen.getAllByText('no history yet').length).toBe(8);
    expect(screen.getByPlaceholderText('e.g. 215000').props.value).toBe('');

    // Back to car A: its entry and odometer are still there.
    selectCar('golf-plus-2009-20tdi');
    expect(screen.getAllByText('no history yet').length).toBe(7);
    expect(screen.getByPlaceholderText('e.g. 215000').props.value).toBe('215000');
  });
});
