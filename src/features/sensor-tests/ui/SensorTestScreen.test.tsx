/** Sensor tests module readings (plan 25): each reading carries the verification badge instead of
 *  the old "Unverified" warning, amber while illustrative and blue once the sensor is confirmed
 *  (`useSensorTests` carries the evidence from the profile onto the reading). */
import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { CONFIRMED_TEXT, ILLUSTRATIVE_TEXT, confirmItems } from '@test/confirmation';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useSensorTestStore } from '../model/sensorTestStore';
import { SensorTestScreen } from './SensorTestScreen';

// Not in the shared reset list: start each test with no readings so the wait below sees this run's.
beforeEach(() => useSensorTestStore.setState({ moduleReadings: [], mode05: [], mode06: [] }));

async function golfRun() {
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
  renderWithProviders(<SensorTestScreen />);
  await act(async () => {
    fireEvent.press(screen.getByText('Run tests'));
  });
  await screen.findByTestId('verify-sensor-1', {}, { timeout: 4000 });
}

describe('SensorTestScreen — verification badge', () => {
  it('badges an illustrative module sensor and drops the old warning', async () => {
    await golfRun();
    expect(within(screen.getByTestId('verify-sensor-0')).getByText(ILLUSTRATIVE_TEXT)).toBeTruthy();
    expect(screen.queryByText(/^Unverified, CAN-only/)).toBeNull();
  });

  it('badges a confirmed sensor as confirmed', async () => {
    const [first] = getVehicleProfile('golf-plus-2009-20tdi').moduleSensors!;
    const undo = confirmItems([first]);
    try {
      await golfRun();
      expect(within(screen.getByTestId('verify-sensor-0')).getByText(CONFIRMED_TEXT)).toBeTruthy();
      expect(
        within(screen.getByTestId('verify-sensor-1')).getByText(ILLUSTRATIVE_TEXT),
      ).toBeTruthy();
    } finally {
      undo();
    }
  });
});
