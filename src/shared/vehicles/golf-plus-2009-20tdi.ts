import { VehicleProfile } from './types';

/** VW Golf Plus 2009 2.0 TDI 81 kW — modern CAN diesel. See docs/vehicles/golf-plus-2009-20tdi.md. */
export const golfPlus2009: VehicleProfile = {
  id: 'golf-plus-2009-20tdi',
  name: 'VW Golf Plus 2009 2.0 TDI 81 kW',
  year: 2009,
  engine: '2.0 TDI CBD, 81 kW / 109 cp (ECU 03L 906 022 LM)',
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
  notes:
    'Reference happy-path car: conventional diesel Golf Plus, CAN, fast, full generic data. VCDS reports engine code CBD and ECU 03L 906 022 LM. Not an e-Golf.',
  testChecklist: [
    'Connect over BLE with ignition on; confirm protocol is CAN 11/500.',
    'Read VIN and confirm it matches WVWZZZ1KZ9W903398.',
    'Start engine; confirm RPM ~820 idle, coolant rises, voltage ~14 V.',
    'Read DTCs; compare against known VCDS engine faults P2015 and P2183 if they are still present.',
    'Toggle the experimental extended PID and record whether a plausible value returns.',
  ],
};
