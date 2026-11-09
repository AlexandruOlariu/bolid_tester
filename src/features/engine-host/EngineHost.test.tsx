/** EngineHost's connect-time VIN auto-select (plan 06): connecting a car whose VIN matches a garage
 *  car selects it; another car's VIN leaves the selection alone; the setting turns it off. */
import React from 'react';
import { render } from '@testing-library/react-native';
import { connectSimulator } from '@test/simulator';
import { useGarageStore } from '@/shared/state/garageStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { EngineHost } from './EngineHost';

const GOLF_VIN = 'WVWZZZ1KZ9W903398';

function addLearnedGolf() {
  return useGarageStore.getState().add({
    name: 'Volkswagen 2009',
    fuel: 'diesel',
    baseProfileId: 'generic',
    learned: {
      protocol: 'ISO_15765_4_CAN_11_500',
      supportedPids: ['010C', '010D'],
      vin: GOLF_VIN,
      calibrationId: null,
      learnedAt: 1,
    },
  });
}

describe('EngineHost VIN auto-select', () => {
  it('selects the garage car whose learned VIN connects', async () => {
    const car = addLearnedGolf();
    render(<EngineHost />);
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    expect(useVehicleStore.getState().selectedProfileId).toBe(car.id);
  });

  it('leaves the selection alone for another car', async () => {
    addLearnedGolf();
    render(<EngineHost />);
    await connectSimulator({ vehicleId: 'fiat-punto-2008-12' });
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');
  });

  it('does nothing when "Recognise my cars by VIN" is off', async () => {
    addLearnedGolf();
    useSettingsStore.setState({ autoSelectByVin: false });
    render(<EngineHost />);
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');
  });
});
