import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { setMockWindow, TABLET_WINDOW } from '@test/mocks/window';
import { connectSimulator } from '@test/simulator';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { useGarageStore } from '@/shared/state/garageStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '../model/vehicleStore';
import { VehicleSelectScreen, GARAGE_COPY } from './VehicleSelectScreen';
import { translate } from '@/shared/i18n';
import { EditorBody } from './VehicleEditorSheet';
import * as garageExportFile from '../api/garageExportFile';
import * as exchangeApi from '../api/exchange';
import * as exchangeService from '@/shared/state/exchangeService';
import { serializeExchange } from '@/shared/lib/exchange';

const GOLF = 'VW Golf Plus 2009 2.0 TDI 81 kW';
const GOLF_6 = 'VW Golf 6 2010 1.4 TSI 90 kW';
const SUGGESTION = /tap to switch to that profile/;
const SUGGESTION_A11Y = (name: string) => translate('vehicleSelect:match.profileA11y', { name });

describe('VehicleSelectScreen', () => {
  it('lists the six built-in profiles', () => {
    renderWithProviders(<VehicleSelectScreen />);

    expect(VEHICLE_PROFILES).toHaveLength(6);
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

  it('a VIN that several profiles match equally well offers one card per candidate', async () => {
    // A synthetic 1K VIN of a model year neither the Golf Plus (Z9) nor the Golf 6 (ZA) pins down.
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    act(() => {
      const s = useSessionStore.getState();
      if (s.info) useSessionStore.setState({ info: { ...s.info, vin: 'WVWZZZ1KZCW000001' } });
    });
    renderWithProviders(<VehicleSelectScreen />);

    expect(screen.getAllByText(SUGGESTION)).toHaveLength(2);
    expect(screen.getByLabelText(SUGGESTION_A11Y(GOLF))).toBeTruthy();
    fireEvent.press(screen.getByLabelText(SUGGESTION_A11Y(GOLF_6)));

    expect(useVehicleStore.getState().selectedProfileId).toBe('golf-6-2010-14tsi');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
    // Either candidate being active hides every card: the VIN is accounted for.
    expect(screen.queryByText(SUGGESTION)).toBeNull();
  });

  it('shows the garage section with both add actions; "from connected car" needs a connection', () => {
    renderWithProviders(<VehicleSelectScreen />);
    expect(screen.getByText('My garage')).toBeTruthy();
    expect(screen.getByText('Built-in profiles')).toBeTruthy();
    expect(screen.getByText(translate(GARAGE_COPY))).toBeTruthy();
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

  it("lists the car's login codes masked, reveals one, and deletes it on Save (plan 22)", () => {
    const car = useGarageStore.getState().add({
      name: 'My Passat',
      fuel: 'diesel',
      baseProfileId: 'passat-b55-19tdi',
      loginCodes: [
        { address: '01', code: 1234, purpose: 'Idle speed adaptation', source: 'user-entered' },
      ],
    });
    renderWithProviders(<EditorBody vehicle={car} onClose={jest.fn()} />);

    expect(screen.getByText('Login codes')).toBeTruthy();
    expect(screen.getByText('Module 01 · Idle speed adaptation')).toBeTruthy();
    expect(screen.getByText('Code •••••')).toBeTruthy();
    expect(screen.queryByText('Code 01234')).toBeNull();
    fireEvent.press(screen.getByLabelText('Show login code for module 01'));
    expect(screen.getByText('Code 01234')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Delete login code for module 01'));
    expect(screen.getByText('No login codes saved for this car.')).toBeTruthy();
    // Not gone until Save.
    expect(useGarageStore.getState().vehicles[0].loginCodes).toHaveLength(1);
    fireEvent.press(screen.getByText('Save'));
    expect(useGarageStore.getState().vehicles[0].loginCodes).toBeUndefined();
  });

  it('a new car has no login-codes section', () => {
    renderWithProviders(<EditorBody vehicle={null} onClose={jest.fn()} />);
    expect(screen.queryByText('Login codes')).toBeNull();
  });
});

describe('VehicleSelectScreen — profile import / export (plan 13)', () => {
  // The UI project cannot run the variable-specifier native imports; the file write and the picker
  // are covered in shared/state/exchangeService.test.ts. Here: what the screen asks for.
  it('Export on a garage card shares that car', async () => {
    const share = jest
      .spyOn(exchangeApi, 'shareVehicleFile')
      .mockResolvedValue('file:///test/x.json');
    const car = useGarageStore
      .getState()
      .add({ name: 'Dacia Logan', fuel: 'petrol', baseProfileId: 'generic' });
    renderWithProviders(<VehicleSelectScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Export Dacia Logan'));
    });
    expect(share).toHaveBeenCalledWith(car);
    expect(screen.getByTestId('profile-export-note')).toHaveTextContent('Saved x.json.');
    share.mockRestore();
  });

  it('a built-in profile (not Auto / Generic) shares as a starting profile', async () => {
    const share = jest.spyOn(exchangeApi, 'shareProfileSeedFile').mockResolvedValue(null);
    renderWithProviders(<VehicleSelectScreen />);
    expect(screen.getAllByText('Share as starting profile')).toHaveLength(
      VEHICLE_PROFILES.length - 1,
    );
    await act(async () => {
      fireEvent.press(screen.getByLabelText(`Share ${GOLF} as a starting profile`));
    });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ id: 'golf-plus-2009-20tdi' }));
    expect(screen.getByTestId('profile-export-note')).toHaveTextContent(/Could not export/);
    // Choosing the profile is not triggered by the nested button.
    expect(useVehicleStore.getState().selectedProfileId).not.toBe('golf-plus-2009-20tdi');
    share.mockRestore();
  });

  it('Import profile: an exported car appears as an identical card on a cleared app', async () => {
    const source = useGarageStore.getState().add({
      name: 'Volkswagen 2009',
      year: 2009,
      fuel: 'diesel',
      baseProfileId: 'golf-plus-2009-20tdi',
      learned: {
        protocol: 'ISO_15765_4_CAN_11_500',
        supportedPids: ['010C', '010D', '0105'],
        vin: 'WVWZZZ1KZ9W903398',
        calibrationId: null,
        learnedAt: 1,
      },
    });
    const text = serializeExchange(exchangeService.vehicleExportFile(source));
    useGarageStore.setState({ vehicles: [] }); // "another phone"
    const load = jest.spyOn(exchangeService, 'loadExchangeModules').mockResolvedValue({
      FileSystem: {
        documentDirectory: 'file:///test/',
        getInfoAsync: async () => ({ exists: true, size: text.length }),
        readAsStringAsync: async () => text,
        writeAsStringAsync: async () => undefined,
      },
      Sharing: null,
      Picker: {
        getDocumentAsync: async () => ({
          canceled: false,
          assets: [{ uri: 'file:///cache/car.json', name: 'car.json' }],
        }),
      },
    });
    renderWithProviders(<VehicleSelectScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Import profile'));
    });
    expect(await screen.findByText('Import car profile')).toBeTruthy();
    expect(screen.getByText('03398')).toBeTruthy(); // VIN ending
    await act(async () => {
      fireEvent.press(screen.getByText('Import'));
    });
    expect(screen.getByText('Imported Volkswagen 2009.')).toBeTruthy();
    const [car] = useGarageStore.getState().vehicles;
    expect(car.learned).toEqual(source.learned);
    expect(screen.getByText('Volkswagen 2009 ·03398')).toBeTruthy();
    expect(screen.getByText('3 PIDs')).toBeTruthy();
    load.mockRestore();
  });

  it('Import profile without the file picker in the build explains why', async () => {
    const load = jest.spyOn(exchangeService, 'loadExchangeModules').mockResolvedValue(null);
    renderWithProviders(<VehicleSelectScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Import profile'));
    });
    expect(screen.getByText(/needs the file picker/)).toBeTruthy();
    load.mockRestore();
  });

  describe('screen reader (plan 20)', () => {
    it('each profile card is a button naming the car, its protocol and whether it is selected', () => {
      renderWithProviders(<VehicleSelectScreen />);
      const golf = screen.getByRole('button', {
        name: `${GOLF}. ISO 15765-4 CAN (11-bit, 500 kbps). Not selected`,
      });
      expect(golf).not.toBeSelected();
      expect(
        screen.getByRole('button', { name: /^Auto \/ Generic OBD2\. .*\. Selected$/ }),
      ).toBeSelected();
      fireEvent.press(golf);
      expect(useVehicleStore.getState().selectedProfileId).toBe('golf-plus-2009-20tdi');
      expect(
        screen.getByRole('button', {
          name: `${GOLF}. ISO 15765-4 CAN (11-bit, 500 kbps). Selected`,
        }),
      ).toBeSelected();
    });

    it("a card's inner buttons are also its screen-reader actions", async () => {
      const share = jest.spyOn(exchangeApi, 'shareProfileSeedFile').mockResolvedValue(null);
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      useGarageStore.setState({
        vehicles: [
          {
            id: 'user:a',
            name: 'Car A',
            fuel: 'petrol',
            baseProfileId: 'generic',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });
      renderWithProviders(<VehicleSelectScreen />);
      const car = screen.getByRole('button', { name: /^Car A\. added by hand\. Not selected$/ });
      expect(car.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual([
        'Edit',
        'Export',
        'Delete',
      ]);
      fireEvent(car, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
      expect(alert).toHaveBeenCalledWith('Delete this car?', expect.any(String), expect.any(Array));

      const golf = screen.getByRole('button', {
        name: `${GOLF}. ISO 15765-4 CAN (11-bit, 500 kbps). Not selected`,
      });
      await act(async () => {
        fireEvent(golf, 'accessibilityAction', { nativeEvent: { actionName: 'share' } });
      });
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ id: 'golf-plus-2009-20tdi' }));
      share.mockRestore();
      alert.mockRestore();
    });
  });

  describe('tablet layout (plan 21)', () => {
    it('shows the built-in profiles and the garage in two columns', () => {
      useGarageStore.setState({
        vehicles: [
          {
            id: 'user:a',
            name: 'Car A',
            fuel: 'petrol',
            baseProfileId: 'generic',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'user:b',
            name: 'Car B',
            fuel: 'diesel',
            baseProfileId: 'generic',
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });
      setMockWindow(TABLET_WINDOW);
      renderWithProviders(<VehicleSelectScreen />);

      const profiles = screen.getAllByTestId('profiles-grid-cell');
      expect(profiles).toHaveLength(VEHICLE_PROFILES.length);
      expect(profiles[0]).toHaveStyle({ flexBasis: '49%' });
      expect(within(profiles[1]).getByText(VEHICLE_PROFILES[1].name)).toBeTruthy();
      expect(screen.getAllByTestId('garage-grid-cell')).toHaveLength(2);
    });

    it('keeps one column on a phone', () => {
      renderWithProviders(<VehicleSelectScreen />);
      expect(screen.queryAllByTestId('profiles-grid-cell')).toHaveLength(0);
      expect(screen.getByText(GOLF)).toBeTruthy();
    });
  });
});
