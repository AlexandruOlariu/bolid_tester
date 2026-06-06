import { VehicleProfile } from './types';

/** Fiat Punto 1.2 2007 (petrol) — older K-line or CAN. See docs/vehicles/fiat-punto-2007-12.md. */
export const fiatPunto2007: VehicleProfile = {
  id: 'fiat-punto-2007-12',
  name: 'Fiat Punto 1.2 2007 (petrol)',
  year: 2007,
  engine: '1.2 8v petrol',
  fuel: 'petrol',
  expectedProtocol: 'ISO_14230_4_KWP_FAST',
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
    '0110',
    '0111',
    '011F',
    '012F',
    '0142',
  ],
  dtcModes: ['03', '07'],
  notes:
    'Protocol depends on the exact variant (older Punto = K-line, Grande Punto = CAN). Update the ' +
    'expected protocol after the first real connection.',
  testChecklist: [
    'Connect over BLE; record the negotiated protocol (K-line vs CAN) in this profile.',
    'Read idle live data: RPM ~850, coolant, throttle, fuel trims near 0%.',
    'Read VIN if supported (older K-line ECUs may not answer Mode 09 — record the result).',
    'Read DTCs; clear a harmless one and confirm.',
  ],
};
