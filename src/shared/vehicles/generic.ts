import { VehicleProfile } from './types';

/** Built-in fallback profile: works for any OBD2 car. No per-car assumptions; the app discovers
 *  everything from the ECU's supported-PID bitmaps at runtime. */
export const generic: VehicleProfile = {
  id: 'generic',
  name: 'Auto / Generic OBD2',
  year: 0,
  engine: '—',
  fuel: 'other',
  expectedProtocol: 'AUTO',
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
    '0121',
    '012F',
    '0133',
    '0142',
    '0146',
    '015C',
  ],
  dtcModes: ['03', '07', '0A'],
  notes:
    'Generic profile used when no dedicated profile is selected. The dashboard shows whatever the ' +
    'connected ECU reports as supported.',
  testChecklist: [],
};
