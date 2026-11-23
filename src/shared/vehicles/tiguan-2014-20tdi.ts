import { VehicleProfile } from './types';

/** VW Tiguan 2014 2.0 TDI 81 kW (CFFD) — thin profile from registration data. See
 *  docs/vehicles/tiguan-2014-20tdi.md. */
export const tiguan2014: VehicleProfile = {
  id: 'tiguan-2014-20tdi',
  name: 'VW Tiguan 2014 2.0 TDI 81 kW',
  year: 2014,
  engine: '2.0 TDI CFFD, 81 kW / 110 cp',
  fuel: 'diesel',
  make: 'vag',
  expectedProtocol: 'ISO_15765_4_CAN_11_500',
  vinPatterns: ['WVGZZZ5N'],
  supportedPids: [
    '0104',
    '0105',
    '010B',
    '010C',
    '010D',
    '010F',
    '0110',
    '0111',
    '011F',
    '0121',
    '0131',
    '0133',
    '0142',
    '0146',
    '015C',
    '015E',
  ],
  dtcModes: ['03', '07'],
  notes:
    'Thin profile written from the registration certificate (5N body, model year 2014, 1968 cm3, ' +
    '81 kW diesel with a particulate filter); not yet validated on a car. The engine code CFFD is ' +
    'confirmed by the owner. The PID list is expected by analogy with the Golf Plus 2.0 TDI ' +
    '(same common-rail family), not observed; the real set is discovered at connect. Mode 0A is ' +
    'not declared until a car answers it.',
  testChecklist: [
    'Connect with ignition on; confirm the negotiated protocol is CAN 11/500.',
    'Read VIN (Mode 09) and confirm it matches the registration certificate.',
    'Start the engine; read idle live data: RPM, coolant, MAP, MAF, voltage (~14 V).',
    'Compare the discovered PID list with the 16 expected; note every difference.',
    'Read DTCs (Mode 03/07); note whether Mode 0A answers.',
  ],
};
