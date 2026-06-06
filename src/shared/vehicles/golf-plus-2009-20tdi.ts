import { VehicleProfile } from './types';

/** VW Golf Plus 2009 2.0 TDI 110cp — modern CAN diesel. See docs/vehicles/golf-plus-2009-20tdi.md. */
export const golfPlus2009: VehicleProfile = {
  id: 'golf-plus-2009-20tdi',
  name: 'VW Golf Plus 2009 2.0 TDI 110cp',
  year: 2009,
  engine: '2.0 TDI (CBAB/BMM-class)',
  fuel: 'diesel',
  expectedProtocol: 'ISO_15765_4_CAN_11_500',
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
  dtcModes: ['03', '07', '0A'],
  extendedPids: [
    {
      // ⚠️ Illustrative DID — must be confirmed on the real car. See docs/features/extended-pids.md.
      did: '1701',
      name: 'DPF soot mass (experimental)',
      unit: 'g',
      experimental: true,
      sampleResponse: [0x00, 0x2a],
      decode: (d) => (d[0] * 256 + d[1]) / 100,
    },
  ],
  notes: 'Reference happy-path car: CAN, fast, full generic data.',
  testChecklist: [
    'Connect over BLE with ignition on; confirm protocol is CAN 11/500.',
    'Read VIN and confirm it matches the windscreen.',
    'Start engine; confirm RPM ~820 idle, coolant rises, voltage ~14 V.',
    'Read DTCs; if a harmless one is present, clear it and confirm it is gone.',
    'Toggle the experimental extended PID and record whether a plausible value returns.',
  ],
};
