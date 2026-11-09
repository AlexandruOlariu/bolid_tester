import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { connectSimulator } from '@test/simulator';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '../model/vehicleStore';
import { VehicleSelectScreen, GARAGE_COPY } from './VehicleSelectScreen';
import { EditorBody } from './VehicleEditorSheet';
import * as garageExportFile from '../api/garageExportFile';

const GOLF = 'VW Golf Plus 2009 2.0 TDI 81 kW';
const SUGGESTION = /tap to switch to that profile/;

describe('VehicleSelectScreen', () => {
  it('lists the four built-in profiles', () => {
    renderWithProviders(<VehicleSelectScreen />);

    expect(VEHICLE_PROFILES).toHaveLength(4);
    for (const p of VEHICLE_PROFILES) expect(screen.getByText(p.name)).toBeTruthy();
    // No session → no VIN → no suggestion card.
    expect(screen.queryByText(SUGGESTION)).toBeNull();
  });

  it('tapping the Golf selects it and opens the Live tab', () => {
    renderWithProviders(<VehicleSelectScreen />);

    fireEvent.press(screen.getByText(GOLF));

    expect(useVehicleStore.getState().selectedProfileId).toBe('golf-plus-2009-20tdi');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it("suggests the matching profile from the connected car's VIN", async () => {
    // The simulated Golf reports a WVWZZZ1K… VIN while the selected profile is still Auto / Generic.
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<VehicleSelectScreen />);

    const card = screen.getByText(SUGGESTION);
    expect(screen.getByText(/WVWZZZ1KZ9W903398/)).toBeTruthy();
    fireEvent.press(card);

    expect(useVehicleStore.getState().selectedProfileId).toBe('golf-plus-2009-20tdi');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
    // Once the suggested profile is active the card goes away.
    expect(screen.queryByText(SUGGESTION)).toBeNull();
  });

  it('shows the garage section with both add actions; "from connected car" needs a connection', () => {
    renderWithProviders(<VehicleSelectScreen />);
    expect(screen.getByText('My garage')).toBeTruthy();
    expect(screen.getByText('Built-in profiles')).toBeTruthy();
    expect(screen.getByText(GARAGE_COPY)).toBeTruthy();
    expect(screen.getByText('No cars in your garage yet.')).toBeTruthy();
    expect(screen.getByText(/Connect to a car first/)).toBeTruthy();

    fireEvent.press(screen.getByText('Add from connected car'));
    expect(useGarageStore.getState().vehicles).toEqual([]);
  });

  it('adds the connected simulated Golf to the garage and selects it', async () => {
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<VehicleSelectScreen />);

    fireEvent.press(screen.getByText('Add from connected car'));

    const [car] = useGarageStore.getState().vehicles;
    expect(car.name).toBe('Volkswagen 2009');
    expect(car.learned?.vin).toBe('WVWZZZ1KZ9W903398');
    expect(useVehicleStore.getState().selectedProfileId).toBe(car.id);
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
    // The garage card shows name + VIN suffix; the registry suggestion gives way to the garage car.
    expect(screen.getByText('Volkswagen 2009 ·03398')).toBeTruthy();
    expect(screen.queryByText(SUGGESTION)).toBeNull();
    expect(screen.queryByText('No cars in your garage yet.')).toBeNull();
  });

  it('re-learns the garage car instead of adding a duplicate when its VIN is connected', async () => {
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<VehicleSelectScreen />);
    fireEvent.press(screen.getByText('Add from connected car'));
    const [car] = useGarageStore.getState().vehicles;
    act(() => {
      useGarageStore.getState().update(car.id, { name: 'My Golf', notes: 'family car' });
    });

    expect(screen.queryByText('Add from connected car')).toBeNull();
    expect(screen.getByText(/already in your garage as My Golf/)).toBeTruthy();
    fireEvent.press(screen.getByText('Re-learn from connected car'));

    const vehicles = useGarageStore.getState().vehicles;
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ id: car.id, name: 'My Golf', notes: 'family car' });
    expect(vehicles[0].learned?.vin).toBe('WVWZZZ1KZ9W903398');
    expect(useVehicleStore.getState().selectedProfileId).toBe(car.id);
  });

  it('offers the matching garage car when another profile is selected', async () => {
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<VehicleSelectScreen />);
    fireEvent.press(screen.getByText('Add from connected car'));
    const [car] = useGarageStore.getState().vehicles;

    act(() => {
      useVehicleStore.getState().select('generic');
    });
    fireEvent.press(screen.getByText(/from your garage — tap to switch to it/));
    expect(useVehicleStore.getState().selectedProfileId).toBe(car.id);
  });

  it('deleting the selected garage car (after confirming) falls back to Auto / Generic', () => {
    const car = useGarageStore
      .getState()
      .add({ name: 'Dacia Logan', fuel: 'petrol', baseProfileId: 'generic' });
    useVehicleStore.getState().select(car.id);
    const alert = jest.spyOn(Alert, 'alert');
    renderWithProviders(<VehicleSelectScreen />);

    fireEvent.press(screen.getByLabelText('Delete Dacia Logan'));
    expect(alert).toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] ?? [];
    act(() => {
      buttons.find((b) => b.style === 'destructive')?.onPress?.();
    });

    expect(useGarageStore.getState().vehicles).toEqual([]);
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');
    expect(screen.getByText('No cars in your garage yet.')).toBeTruthy();
  });
});

describe('VehicleEditorSheet', () => {
  it('validates, then adds a car by hand', () => {
    const onClose = jest.fn();
    const onSaved = jest.fn();
    renderWithProviders(<EditorBody vehicle={null} onClose={onClose} onSaved={onSaved} />);

    fireEvent.press(screen.getByText('Save'));
    expect(screen.getByText(/Give the car a name/)).toBeTruthy();
    expect(useGarageStore.getState().vehicles).toEqual([]);

    fireEvent.changeText(screen.getByLabelText('Car name'), 'Dacia Logan');
    fireEvent.changeText(screen.getByLabelText('Model year'), '2015');
    fireEvent.press(screen.getByText('Diesel'));
    fireEvent.press(screen.getByText(VEHICLE_PROFILES[1].name));
    fireEvent.press(screen.getByText('Save'));

    const [car] = useGarageStore.getState().vehicles;
    expect(car).toMatchObject({
      name: 'Dacia Logan',
      year: 2015,
      fuel: 'diesel',
      baseProfileId: VEHICLE_PROFILES[1].id,
    });
    expect(onSaved).toHaveBeenCalledWith(car);
    expect(onClose).toHaveBeenCalled();
  });

  it('edits an existing car in place', () => {
    const car = useGarageStore
      .getState()
      .add({ name: 'Logan', year: 2015, fuel: 'petrol', baseProfileId: 'generic' });
    renderWithProviders(<EditorBody vehicle={car} onClose={jest.fn()} />);
    expect(screen.getByDisplayValue('Logan')).toBeTruthy();
    expect(screen.getByDisplayValue('2015')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Car name'), 'Logan MCV');
    fireEvent.changeText(screen.getByLabelText('Model year'), '');
    fireEvent.press(screen.getByText('Save'));

    const [saved] = useGarageStore.getState().vehicles;
    expect(saved.id).toBe(car.id);
    expect(saved.name).toBe('Logan MCV');
    expect(saved.year).toBeUndefined();
  });

  it('"Share garage as JSON" exports the current garage', async () => {
    // The file write itself is covered in api/garageExportFile.test.ts (the UI project cannot run the
    // variable-specifier native imports); here the button must hand the garage to it.
    const save = jest
      .spyOn(garageExportFile, 'saveGarageExport')
      .mockResolvedValue('file:///x.json');
    const car = useGarageStore
      .getState()
      .add({ name: 'Dacia Logan', fuel: 'petrol', baseProfileId: 'generic' });
    renderWithProviders(<EditorBody vehicle={null} onClose={jest.fn()} />);

    await act(async () => {
      fireEvent.press(screen.getByText('Share garage as JSON'));
    });

    expect(save).toHaveBeenCalledWith([car]);
    save.mockRestore();
  });
});
