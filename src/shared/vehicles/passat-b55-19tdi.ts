import { VehicleProfile } from './types';

/** VW Passat B5.5 1.9 TDI 105cp — older K-line diesel (the hard case).
 *  See docs/vehicles/passat-b55-19tdi.md. */
export const passatB55: VehicleProfile = {
  id: 'passat-b55-19tdi',
  name: 'VW Passat B5.5 1.9 TDI 105cp',
  year: 2004,
  engine: '1.9 PD TDI (AVF/BLB-class)',
  fuel: 'diesel',
  expectedProtocol: 'ISO_14230_4_KWP_FAST',
  supportedPids: [
    '0104',
    '0105',
    '010B',
    '010C',
    '010D',
    '010F',
    '0111',
    '011F',
    '0142',
  ],
  dtcModes: ['03', '07'],
  notes:
    'K-line: slower and thinner than CAN. Missing MAF/oil/fuel-rate via generic OBD2 is expected ' +
    '(that data lives in VAG measuring blocks, out of scope). Mode 22 does not apply here.',
  testChecklist: [
    'Connect over BLE; expect a brief BUS INIT / SEARCHING. Confirm KWP2000 (fast) or ISO 9141-2.',
    'Read live data slowly: RPM ~850, coolant, MAP/boost, IAT, voltage.',
    'Some PIDs will show "not supported" — that is expected.',
    'Read VIN (Mode 09 may be unsupported — record the result).',
    'Read DTCs; clear a harmless one and confirm.',
  ],
};
