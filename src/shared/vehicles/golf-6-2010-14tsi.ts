import { VehicleProfile } from './types';

/** VW Golf 6 2010 1.4 TSI 90 kW (CAXA) — thin profile from registration data. See
 *  docs/vehicles/golf-6-2010-14tsi.md. */
export const golf6Tsi: VehicleProfile = {
  id: 'golf-6-2010-14tsi',
  name: 'VW Golf 6 2010 1.4 TSI 90 kW',
  year: 2010,
  engine: '1.4 TSI CAXA, 90 kW / 122 cp',
  fuel: 'petrol',
  make: 'vag',
  expectedProtocol: 'ISO_15765_4_CAN_11_500',
  vinPatterns: ['WVWZZZ1KZA', 'WVWZZZ1K'],
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
    '0121',
    '0131',
    '0133',
    '0142',
  ],
  dtcModes: ['03', '07'],
  notes:
    'Thin profile written from a vehicle-history report (5K, model year 2010, built 2010-01, ' +
    '1.4 l petrol, 90 kW); not yet validated on a car. The engine code CAXA is confirmed by the ' +
    'owner. The CAXA is MAP-based, so MAF (0110) is not expected. The PID list is expected, not ' +
    'observed; the real set is discovered at connect. Mode 0A is not declared until a car answers ' +
    'it.',
  testChecklist: [
    'Connect with ignition on; confirm the negotiated protocol is CAN 11/500.',
    'Read VIN (Mode 09) and confirm it matches the registration certificate.',
    'Start the engine; read idle live data: RPM, coolant, MAP, fuel trims (near 0 %), timing advance, voltage (~14 V).',
    'Compare the discovered PID list with the 15 expected; note every difference.',
    'Read DTCs (Mode 03/07); note whether Mode 0A answers.',
  ],
};
