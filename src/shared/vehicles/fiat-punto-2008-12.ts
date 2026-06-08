import { VehicleProfile } from './types';

/** Fiat Grande Punto 1.2 2008 (petrol) — 199-body CAN. See docs/vehicles/fiat-punto-2008-12.md. */
export const fiatPunto2008: VehicleProfile = {
  id: 'fiat-punto-2008-12',
  name: 'Fiat Grande Punto 1.2 2008 (petrol)',
  year: 2008,
  engine: '1.2 8v petrol (199A4.000 FIRE, 48 kW)',
  fuel: 'petrol',
  expectedProtocol: 'ISO_15765_4_CAN_11_500',
  supportedPids: [
    '0104',
    '0105',
    '0106',
    '0107',
    '010B',
    '010C',
    '010D',
    '010E',
    '010F',
    '0111',
    '011F',
    '012F',
    '0142',
  ],
  dtcModes: ['03', '07'],
  notes:
    'Grande Punto (199 body) on CAN 11/500 — behaves like the Golf reference. The 1.2 8v FIRE is ' +
    'MAP/speed-density (no MAF). Mode 0A permanent DTCs are often absent on this EU generation.',
  testChecklist: [
    'Connect over BLE with ignition on; confirm protocol is CAN 11/500.',
    'Read VIN (Mode 09) and confirm it matches the windscreen.',
    'Read idle live data: RPM ~850, coolant, throttle, fuel trims near 0%, MAP.',
    'Read DTCs (Mode 03/07); clear a harmless one and confirm.',
  ],
};
