import { VehicleProfile } from './types';

/** VW Passat B5.5 1.9 TDI AVB — older K-line diesel (the hard case).
 *  See docs/vehicles/passat-b55-19tdi.md. */
export const passatB55: VehicleProfile = {
  id: 'passat-b55-19tdi',
  name: 'VW Passat B5.5 1.9 TDI AVB',
  year: 2004,
  engine: '1.9 TDI AVB-family (ECU 038 906 019 KC)',
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
  serviceReset: {
    // EXPERIMENTAL / illustrative KWP2000 (K-line) path. On a real B5.5 the reliable method is often
    // the dash stalk buttons; a generic ELM327 KWP reset is slower and car-specific. Confirm first.
    module: 'Instrument cluster (KWP2000)',
    reqHeader: '8A1710',
    rxFilter: '',
    transport: 'kwp',
    session: 0x85,
    method: 'routine',
    routineId: '01',
    experimental: true,
  },
  notes:
    'K-line: slower and thinner than CAN. VCDS reports engine label 038-906-019-AVB and ECU ' +
    '038 906 019 KC. Missing MAF/oil/fuel-rate via generic OBD2 is expected (that data lives in ' +
    'VAG measuring blocks, out of scope). Mode 22 does not apply here.',
  testChecklist: [
    'Connect over BLE; expect a brief BUS INIT / SEARCHING. Confirm KWP2000 (fast) or ISO 9141-2.',
    'Read live data slowly: RPM ~850, coolant, MAP/boost, IAT, voltage.',
    'Some PIDs will show "not supported" — that is expected.',
    'Read VIN (Mode 09 may be unsupported); if present, confirm it matches WVWZZZ3BZ4E342958.',
    'Read engine DTCs; VCDS scan from 2025-05-17 had no engine faults.',
  ],
};
