/** "Learn this car", garage delete and the VIN auto-select (plan 06), end to end through the real
 *  connectionService and the simulator (MockTransport). BLE modules and the file system are mocked
 *  as in connectionService.test.ts. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('@/shared/transports/ble/BleTransport', () => ({ BleTransport: jest.fn() }));
jest.mock('@/shared/transports/ble/manager', () => ({ getBleManager: jest.fn() }));
jest.mock('@/shared/transports/ble/permissions', () => ({
  requestBlePermissions: jest.fn(async () => false),
}));

import { connect, disconnect } from '@/features/connection/api/connectionService';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useHistoryStore, historyVehicleKey } from '@/shared/state/historyStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { readAll } from '@/features/fault-codes/api/dtcService';
import { useVehicleStore } from '../model/vehicleStore';
import { getActiveProfile } from './activeProfile';
import {
  autoSelectGarageCarForVin,
  deleteGarageVehicle,
  learnFromConnectedCar,
} from './learnVehicle';

const GOLF = 'golf-plus-2009-20tdi';
const PUNTO = 'fiat-punto-2008-12';
const GOLF_VIN = 'WVWZZZ1KZ9W903398';

async function connectSim(simulatedVehicleId: string) {
  await disconnect();
  useSettingsStore.setState({ adapterSource: 'mock', simulatedVehicleId, injectedDtcs: [] });
  await connect();
  expect(useSessionStore.getState().status).toBe('connected');
}

beforeEach(async () => {
  await disconnect();
  useGarageStore.setState({ vehicles: [] });
  useVehicleStore.setState({ selectedProfileId: 'generic' });
  useHistoryStore.setState({ entries: [] });
  useSettingsStore.setState({ autoSelectByVin: true });
});

afterAll(async () => {
  await disconnect();
});

describe('learnFromConnectedCar', () => {
  it('returns null when not connected', () => {
    expect(learnFromConnectedCar()).toBeNull();
    expect(useGarageStore.getState().vehicles).toEqual([]);
  });

  it('creates and selects a garage car from the simulated Golf', async () => {
    await connectSim(GOLF);
    const info = useSessionStore.getState().info!;
    const car = learnFromConnectedCar()!;

    expect(car.id.startsWith('user:')).toBe(true);
    expect(car.name).toBe('Volkswagen 2009');
    expect(car.year).toBe(2009);
    expect(car.make).toBe('vag');
    expect(car.baseProfileId).toBe('generic');
    expect(car.fuel).toBe(getVehicleProfile('generic').fuel);
    expect(car.learned?.vin).toBe(GOLF_VIN);
    expect(car.learned?.protocol).toBe(info.protocol);
    expect(car.learned?.calibrationId).toBe(info.calibrationId);
    expect(useVehicleStore.getState().selectedProfileId).toBe(car.id);

    // Live uses the observed Golf PID set; history groups under its VIN.
    const active = getActiveProfile();
    expect(active.id).toBe(car.id);
    expect([...active.supportedPids].sort()).toEqual([...info.supportedPids].sort());
    await readAll();
    const entry = useHistoryStore.getState().entries[0];
    expect(entry.vehicle.id).toBe(car.id);
    expect(entry.vehicle.label).toBe('Volkswagen 2009');
    expect(historyVehicleKey(entry.vehicle)).toBe(`vin:${GOLF_VIN}`);
  });

  it('re-learns an existing car in place, keeping its name', async () => {
    await connectSim(GOLF);
    const car = learnFromConnectedCar()!;
    useGarageStore.getState().update(car.id, { name: 'Family Golf' });
    const again = learnFromConnectedCar({ existingId: car.id })!;
    expect(useGarageStore.getState().vehicles).toHaveLength(1);
    expect(again.id).toBe(car.id);
    expect(again.name).toBe('Family Golf');
    expect(again.learned?.vin).toBe(GOLF_VIN);
    expect(learnFromConnectedCar({ existingId: 'user:missing' })).toBeNull();
  });
});

describe('VIN auto-select', () => {
  it('a garage car is reselected when its VIN connects again, and the Punto does not pick it', async () => {
    await connectSim(GOLF);
    const golfCar = learnFromConnectedCar()!;

    // Switch away, reconnect the Golf: recognised.
    useVehicleStore.getState().select('generic');
    await connectSim(GOLF);
    expect(autoSelectGarageCarForVin(useSessionStore.getState().info?.vin)?.id).toBe(golfCar.id);
    expect(useVehicleStore.getState().selectedProfileId).toBe(golfCar.id);

    // The Punto's VIN does not auto-select the Golf garage car.
    useVehicleStore.getState().select('generic');
    await connectSim(PUNTO);
    expect(useSessionStore.getState().info?.vin).not.toBe(GOLF_VIN);
    expect(autoSelectGarageCarForVin(useSessionStore.getState().info?.vin)).toBeNull();
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');

    // Adding it creates a second garage entry.
    const punto = learnFromConnectedCar()!;
    expect(punto.id).not.toBe(golfCar.id);
    expect(punto.make).toBe('fiat');
    expect(useGarageStore.getState().vehicles).toHaveLength(2);
  });

  it('does nothing when the setting is off', async () => {
    await connectSim(GOLF);
    const car = learnFromConnectedCar()!;
    useVehicleStore.getState().select('generic');
    useSettingsStore.setState({ autoSelectByVin: false });
    expect(autoSelectGarageCarForVin(GOLF_VIN)).toBeNull();
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');
    useSettingsStore.setState({ autoSelectByVin: true });
    expect(autoSelectGarageCarForVin(GOLF_VIN)?.id).toBe(car.id);
  });

  it('a garage car as the simulated vehicle reconnects with its learned VIN and PID set', async () => {
    await connectSim(GOLF);
    const first = useSessionStore.getState().info!;
    const car = learnFromConnectedCar()!;
    // Simulate the garage car itself (generic base + learned overrides).
    await connectSim(car.id);
    const info = useSessionStore.getState().info!;
    expect(info.vin).toBe(first.vin);
    expect([...info.supportedPids].sort()).toEqual([...first.supportedPids].sort());
  });
});

describe('deleteGarageVehicle', () => {
  it('deleting the selected car falls back to generic and keeps its history', async () => {
    await connectSim(GOLF);
    const car = learnFromConnectedCar()!;
    await readAll();
    expect(useHistoryStore.getState().entries).toHaveLength(1);

    deleteGarageVehicle(car.id);
    expect(useGarageStore.getState().vehicles).toEqual([]);
    expect(useVehicleStore.getState().selectedProfileId).toBe('generic');
    expect(getActiveProfile().id).toBe('generic');
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(useHistoryStore.getState().entries[0].vehicle.vin).toBe(GOLF_VIN);
  });

  it('deleting another car keeps the selection', () => {
    const a = useGarageStore
      .getState()
      .add({ name: 'A', fuel: 'petrol', baseProfileId: 'generic' });
    const b = useGarageStore
      .getState()
      .add({ name: 'B', fuel: 'petrol', baseProfileId: 'generic' });
    useVehicleStore.getState().select(a.id);
    deleteGarageVehicle(b.id);
    expect(useVehicleStore.getState().selectedProfileId).toBe(a.id);
  });

  it('deleting the simulated car falls back to the registry profile it was simulating', () => {
    const car = useGarageStore
      .getState()
      .add({ name: 'My Golf', fuel: 'diesel', baseProfileId: GOLF });
    const other = useGarageStore
      .getState()
      .add({ name: 'Other', fuel: 'petrol', baseProfileId: 'generic' });
    useSettingsStore.getState().setSimulatedVehicle(car.id);
    deleteGarageVehicle(car.id);
    expect(useSettingsStore.getState().simulatedVehicleId).toBe(GOLF);

    useSettingsStore.getState().setSimulatedVehicle(PUNTO);
    deleteGarageVehicle(other.id);
    expect(useSettingsStore.getState().simulatedVehicleId).toBe(PUNTO);
  });
});
