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
    '0104', '0105', '010B', '010C', '010D', '010F', '0110', '0111',
    '011F', '0121', '0131', '0133', '0142', '0146', '015C', '015E',
  ],
  dtcModes: ['03', '07', '0A'],
  extendedPids: [
    // --- Diesel / DPF pack: EXPERIMENTAL, illustrative VAG-style DIDs. Confirm on the real car.
    // The DPF monitor (docs/features/dpf.md) maps these by `role`; the Extended-PIDs screen shows
    // them raw. The simulator (scenarios.ts) auto-seeds each DID from its sampleResponse.
    {
      did: '1701', name: 'DPF soot mass (calc.)', unit: 'g', experimental: true,
      category: 'dpf', role: 'sootMassG',
      sampleResponse: [0x04, 0xb0], decode: (d) => (d[0] * 256 + d[1]) / 100, // 12.00 g
    },
    {
      did: '1702', name: 'DPF soot load', unit: '%', experimental: true,
      category: 'dpf', role: 'sootPct',
      sampleResponse: [0x8c], decode: (d) => Math.round((d[0] * 100) / 255), // ~55 %
    },
    {
      did: '1703', name: 'DPF ash load', unit: 'g', experimental: true,
      category: 'dpf', role: 'ashMassG',
      sampleResponse: [0x07, 0x08], decode: (d) => (d[0] * 256 + d[1]) / 100, // 18.00 g
    },
    {
      did: '1704', name: 'Distance since regen', unit: 'km', experimental: true,
      category: 'dpf', role: 'kmSinceRegen',
      sampleResponse: [0x01, 0x2c], decode: (d) => d[0] * 256 + d[1], // 300 km
    },
    {
      did: '1705', name: 'Successful regenerations', unit: '', experimental: true,
      category: 'dpf', role: 'regenCount',
      sampleResponse: [0x01, 0x38], decode: (d) => d[0] * 256 + d[1], // 312
    },
    {
      did: '1706', name: 'Exhaust gas temp (DPF)', unit: '°C', experimental: true,
      category: 'dpf', role: 'egtC',
      sampleResponse: [0x09, 0xc4], decode: (d) => (d[0] * 256 + d[1]) / 10, // 250.0 °C
    },
    {
      did: '1707', name: 'Oil temperature', unit: '°C', experimental: true,
      category: 'diesel', role: 'oilTempC',
      sampleResponse: [0x82], decode: (d) => d[0] - 40, // 90 °C
    },
    {
      did: '1708', name: 'EGR valve position', unit: '%', experimental: true,
      category: 'diesel', role: 'egrPct',
      sampleResponse: [0x40], decode: (d) => Math.round((d[0] * 100) / 255), // ~25 %
    },
    // --- Injection pack: EXPERIMENTAL, illustrative VAG-style DIDs (per-injector data is enhanced,
    // not generic OBD-II). Surfaced in the Sensor readings screen's injection section on CAN cars.
    {
      did: '1709', name: 'Injection quantity', unit: 'mg/str', experimental: true,
      category: 'injection',
      sampleResponse: [0x00, 0x96], decode: (d) => (d[0] * 256 + d[1]) / 100, // ~1.50 mg/str
    },
    {
      did: '170A', name: 'Injector correction cyl 1', unit: 'mg/str', experimental: true,
      category: 'injection',
      sampleResponse: [0x80, 0x14], decode: (d) => (d[0] * 256 + d[1] - 0x8000) / 100, // +0.20
    },
    {
      did: '170B', name: 'Injector correction cyl 2', unit: 'mg/str', experimental: true,
      category: 'injection',
      sampleResponse: [0x7f, 0xf6], decode: (d) => (d[0] * 256 + d[1] - 0x8000) / 100, // -0.10
    },
    {
      did: '170C', name: 'Injector correction cyl 3', unit: 'mg/str', experimental: true,
      category: 'injection',
      sampleResponse: [0x80, 0x2d], decode: (d) => (d[0] * 256 + d[1] - 0x8000) / 100, // +0.45
    },
    {
      did: '170D', name: 'Injector correction cyl 4', unit: 'mg/str', experimental: true,
      category: 'injection',
      sampleResponse: [0x7f, 0xce], decode: (d) => (d[0] * 256 + d[1] - 0x8000) / 100, // -0.50
    },
  ],
  mode06Tests: [
    // Standardized Mode 06: illustrative O2-sensor monitor result. Simulator-canned.
    { mid: '01', name: 'O2 sensor B1S1 (Mode 06)', sampleResponse: [0x46, 0x01, 0x8e, 0x0a, 0x01, 0x90, 0x00, 0x64, 0x03, 0x20] },
  ],
  moduleSensors: [
    // EXPERIMENTAL, UNVERIFIED, CAN-only. ABS addressing + DIDs illustrative. See docs/features/sensor-tests.md.
    { module: 'ABS', reqHeader: '760', rxFilter: '768', did: '2061', name: 'Wheel speed FL (experimental)', unit: 'km/h', experimental: true, sampleResponse: [0x00, 0x00], decode: (d) => (d[0] * 256 + d[1]) / 100 },
    { module: 'ABS', reqHeader: '760', rxFilter: '768', did: '2062', name: 'Wheel speed FR (experimental)', unit: 'km/h', experimental: true, sampleResponse: [0x00, 0x00], decode: (d) => (d[0] * 256 + d[1]) / 100 },
    { module: 'ABS', reqHeader: '760', rxFilter: '768', did: '2063', name: 'Wheel speed RL (experimental)', unit: 'km/h', experimental: true, sampleResponse: [0x00, 0x00], decode: (d) => (d[0] * 256 + d[1]) / 100 },
    { module: 'ABS', reqHeader: '760', rxFilter: '768', did: '2064', name: 'Wheel speed RR (experimental)', unit: 'km/h', experimental: true, sampleResponse: [0x00, 0x00], decode: (d) => (d[0] * 256 + d[1]) / 100 },
  ],
  codingModules: [
    // EXPERIMENTAL / DANGER. Illustrative BCM coding. DISABLED by default; UI requires unlock + backup.
    {
      module: 'Central electrics (BCM)',
      reqHeader: '70E',
      rxFilter: '77E',
      codingDid: 'F1A0',
      byteCount: 4,
      schema: [
        { byte: 0, bit: 0, name: 'Daytime running lights' },
        { byte: 0, bit: 1, name: 'Coming-home lights' },
        { byte: 1, bit: 0, name: 'Needle sweep on start' },
      ],
      sampleCoding: [0x01, 0x00, 0x10, 0x00],
      experimental: true,
    },
  ],
  serviceReset: {
    // EXPERIMENTAL / illustrative. Instrument-cluster "reset service" routine; confirm on the real
    // car before trusting. See docs/features/service-reset.md.
    module: 'Instrument cluster',
    reqHeader: '714',
    rxFilter: '77E',
    method: 'routine',
    routineId: '0203',
    experimental: true,
  },
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
