import { VehicleProfile } from './types';

/** VW Golf Plus 2009 2.0 TDI 81 kW — modern CAN diesel. See docs/vehicles/golf-plus-2009-20tdi.md. */
export const golfPlus2009: VehicleProfile = {
  id: 'golf-plus-2009-20tdi',
  name: 'VW Golf Plus 2009 2.0 TDI 81 kW',
  year: 2009,
  engine: '2.0 TDI CBD, 81 kW / 109 cp (ECU 03L 906 022 LM)',
  fuel: 'diesel',
  expectedProtocol: 'ISO_15765_4_CAN_11_500',
  vinPatterns: ['WVWZZZ1K'],
  supportedPids: [
    '0104', '0105', '010B', '010C', '010D', '010F', '0110', '0111',
    '011F', '0121', '0131', '0133', '0142', '0146', '015C', '015E',
  ],
  dtcModes: ['03', '07', '0A'],
  knownFaults: [
    // Ground truth from a year of VCDS scans (212k→224k km, 2025–2026) plus a 2026-05 Car Scanner
    // OBD2 export of THIS car. Only engine-ECU P-codes appear here — the generic OBD2 path the app
    // uses cannot reach the body/chassis modules VCDS also shows (HVAC flap, infotainment bus, etc.).
    {
      code: 'P2183', vagCode: '08579', kind: 'stored',
      description: 'Engine coolant temperature sensor 2 (radiator outlet, G83) — range/performance',
      note: 'Persistent, MIL on for most of 2025; cleared in the last VCDS scans but back (confirmed) in the 2026-05 OBD2 scan.',
    },
    {
      code: 'P2015', vagCode: '08213', kind: 'stored',
      description: 'Intake manifold runner/flap position sensor (bank 1) — range/performance',
      note: 'Persistent across the year, oscillating intermittent↔confirmed; archived/inactive in the latest scans.',
    },
    {
      code: 'P0121', vagCode: '00289', kind: 'stored',
      description: 'Throttle/pedal position sensor (G69) — range/performance / implausible signal',
      note: 'Transient: appeared only in the ~220k–223k km window (late 2025–early 2026). VCDS printed it as both P0121 and 000289.',
    },
  ],
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
    // Intake manifold runner/flap (V157) feedback — the values VCDS shows during the Group 121
    // basic setting (position deviation settling near 0 %, potentiometer ~1.0 V). Illustrative
    // VAG-style DIDs; the real DIDs are unconfirmed (see the flap routine's unavailableReason).
    {
      did: '170E', name: 'Intake flap position', unit: '%', experimental: true,
      category: 'diesel',
      sampleResponse: [0x00], decode: (d) => Math.round((d[0] * 100) / 255), // ~0 % (learned stop)
    },
    {
      did: '170F', name: 'Intake flap potentiometer', unit: 'V', experimental: true,
      category: 'diesel',
      sampleResponse: [0x04, 0x28], decode: (d) => (d[0] * 256 + d[1]) / 1000, // 1.064 V
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
      // Illustrative PQ35 BCM part number so the long-coding helper resolves the vag-bcm-pq35 label
      // pack for extra bit names (merged additively over the schema below). Confirm on the real car.
      partNumber: '1K0937087D',
      byteCount: 4,
      schema: [
        { byte: 0, bit: 0, name: 'Daytime running lights' },
        { byte: 0, bit: 1, name: 'Coming-home lights' },
        { byte: 1, bit: 0, name: 'Needle sweep on start' },
        // Low nibble of byte 2 = comfort one-touch (lane-change) turn-signal blink count.
        { byte: 2, mask: 0x0f, name: 'One-touch turn signal blinks' },
      ],
      sampleCoding: [0x01, 0x00, 0x10, 0x00],
      experimental: true,
    },
  ],
  codingPresets: [
    // EXPERIMENTAL one-tap "tweaks", compiled to the gated BCM (70E) coding write. All reversible;
    // each round-trips against the simulator (scenarios.ts seeds coding['70E']['F1A0']). Illustrative
    // bit/byte positions — confirm on the real car before trusting.
    {
      id: 'golf-drl',
      title: 'Daytime running lights',
      description: 'Enable the always-on daytime running lights (BCM byte 0, bit 0).',
      reqHeader: '70E',
      edits: [{ byte: 0, bit: 0, mask: 0x01, onValue: 0x01, offValue: 0x00 }],
      reversible: true,
    },
    {
      id: 'golf-needle-sweep',
      title: 'Gauge needle sweep on start',
      description: 'Sweep the instrument-cluster needles once when the ignition comes on (BCM byte 1, bit 0).',
      reqHeader: '70E',
      edits: [{ byte: 1, bit: 0, mask: 0x01, onValue: 0x01, offValue: 0x00 }],
      reversible: true,
    },
    {
      id: 'golf-comfort-blink',
      title: 'One-touch turn signals (3 blinks)',
      description: 'Set the comfort lane-change flasher to 3 blinks per tap (BCM byte 2, low nibble). Revert restores off (0).',
      reqHeader: '70E',
      edits: [{ byte: 2, mask: 0x0f, onValue: 0x03, offValue: 0x00 }],
      reversible: true,
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
  routines: [
    // EXPERIMENTAL / illustrative guided routines (engine EDC17). IDs must be confirmed on the
    // real car; the simulator answers positively so the whole flow is testable risk-free.
    {
      module: 'Engine (EDC17)', reqHeader: '7E0', rxFilter: '7E8',
      kind: 'basicSetting', service: '31', id: '0201',
      name: 'DPF service regeneration (stationary)',
      description:
        'Starts a stationary forced DPF regeneration. Engine idling, vehicle stationary, OUTDOORS ' +
        '— the exhaust becomes extremely hot. Takes 20–40 min; do not switch off mid-regen.',
      liveDids: ['1702', '1706'],
      interlocks: { requireIdle: true, maxSpeedKmh: 0 },
      experimental: true,
    },
    {
      // Ground truth from the owner's VCDS 20.4.2 (label file 03L-906-022-CBA.CLB): this is
      // "Intake Manifold Runner/Motor (V157) Adaptation", run as Basic Settings on measuring-block
      // GROUP 121. During the run VCDS shows four fields — a position deviation (0.0 %), a second
      // deviation (~-7.9 %), a status byte (bin 01000110), and the flap potentiometer feedback
      // (~1.064 V). VCDS hides the raw bus request behind its label file, so the actual UDS routine
      // id / KWP measuring-block sequence is still unconfirmed — see `unavailableReason`.
      module: 'Engine (EDC17)', reqHeader: '7E0', rxFilter: '7E8',
      kind: 'basicSetting', service: '31', id: '0301',
      name: 'Intake Manifold Runner/Motor (V157) adaptation',
      vcdsGroup: 121,
      description:
        'Re-learns the intake manifold runner/flap end stops driven by the V157 motor — the VCDS ' +
        '"Basic Settings → Group 121" you run after cleaning or replacing the manifold, and the ' +
        'check for a P2015 (intake flap position, VAG 08213) fault on this car. The ECU sweeps the ' +
        'flap and stores the learned stops; VCDS shows the position deviation settling near 0 % and ' +
        'the potentiometer around 1.0 V. Engine warm and at a steady idle, vehicle stationary, no ' +
        'active faults.',
      liveDids: ['170E', '170F'],
      interlocks: { requireIdle: true, maxSpeedKmh: 0 },
      unavailableReason:
        'VCDS drives this as a measuring-block Basic Setting (Group 121), which on this PQ35 car ' +
        'most likely rides on VW TP2.0 / KWP — a generic ELM327 cannot drive it and the app\'s ' +
        'TP2.0 transport is not implemented yet. The exact request is also unconfirmed because ' +
        'VCDS hides it behind its label file. To capture the real sequence: run the Bus Sniffer ' +
        'here while VCDS performs the Group 121 basic setting, read off the frames on 7E0→7E8 (or ' +
        'the TP2.0 channel), then the routine id / KWP steps can be wired into this profile.',
      experimental: true,
    },
    {
      module: 'Engine (EDC17)', reqHeader: '7E0', rxFilter: '7E8',
      kind: 'outputTest', service: '2F', id: '0130',
      name: 'EGR valve output test',
      description:
        'Drives the EGR valve to 50% duty and holds it until stopped. Ignition on, ENGINE OFF.',
      controlData: [0x40],
      liveDids: ['1708'],
      interlocks: { requireEngineOff: true },
      experimental: true,
    },
  ],
  adaptations: [
    // EXPERIMENTAL / illustrative adaptation channels (engine EDC17). Bounds are deliberately
    // tight; the label pack vag-edc17-03L906022 carries the descriptions. Confirm on the real car.
    {
      module: 'Engine (EDC17)', reqHeader: '7E0', rxFilter: '7E8',
      did: '3001', name: 'Idle speed offset', unit: 'rpm',
      byteCount: 2, min: 750, max: 950, defaultRaw: [0x03, 0x52],
      experimental: true, sampleValue: [0x03, 0x52], // 850 rpm
    },
    {
      module: 'Engine (EDC17)', reqHeader: '7E0', rxFilter: '7E8',
      did: '3002', name: 'EGR base duty', unit: '%',
      byteCount: 1, scale: 0.5, min: 0, max: 100, defaultRaw: [0x64],
      experimental: true, sampleValue: [0x64], // 50 %
    },
  ],
  modules: [
    // Per-module scan ("auto-scan") registry. UDS addressing below is ILLUSTRATIVE (except the
    // standard OBD engine pair 7E0/7E8) and must be confirmed on the real car. TP2.0 modules are
    // listed but skipped until the TP2.0 transport lands. Sample data feeds the simulator.
    {
      address: '01', name: 'Engine (EDC17)', transport: 'uds',
      reqHeader: '7E0', rxFilter: '7E8', experimental: false,
      sampleIdent: { F187: '03L906022LM', F189: '4023', F197: 'R4 2,0L EDC G000AG' },
      sampleDtcs: [
        { bytes: [0x21, 0x83, 0x00], status: 0x09 }, // P2183 coolant sensor 2 — confirmed
        { bytes: [0x20, 0x15, 0x00], status: 0x0c }, // P2015 manifold flap — confirmed+pending
        { bytes: [0x01, 0x21, 0x00], status: 0x04 }, // P0121 throttle pos — pending
      ],
    },
    {
      address: '03', name: 'ABS/ESP (MK60)', transport: 'uds',
      reqHeader: '760', rxFilter: '768', experimental: true,
      sampleIdent: { F187: '1K0907379AC', F197: 'ESP FRONT MK60' },
      sampleDtcs: [{ bytes: [0x41, 0x30, 0x00], status: 0x88 }], // C0130 — confirmed, MIL/warning
    },
    {
      address: '17', name: 'Instrument cluster', transport: 'uds',
      reqHeader: '714', rxFilter: '77E', experimental: true,
      sampleIdent: { F187: '5M0920861B', F197: 'KOMBIINSTRUMENT' },
      sampleDtcs: [],
    },
    {
      address: '19', name: 'CAN gateway (J533)', transport: 'tp20', experimental: true,
      // Pre-UDS PQ35 module: reachable only via VW TP2.0. The gateway install list (below) is what
      // the TP2.0 scan reads to enumerate the rest of the car. See docs/features/tp20.md.
      tp20Address: 0x19, tp20SampleIdent: '7N0909901 Gateway',
    },
    {
      address: '17', name: 'Instrument cluster (TP2.0)', transport: 'tp20', experimental: true,
      tp20Address: 0x17, tp20SampleIdent: '5M0920861B KOMBIINSTRUMENT',
    },
    {
      address: '46', name: 'Central conv. / comfort', transport: 'tp20', experimental: true,
      tp20Address: 0x46, tp20SampleIdent: '1K0959433 Komfortgeraet',
      // Illustrative comfort-system faults for the simulator (VCDS-style 5-digit VAG codes).
      tp20SampleDtcs: [
        { code: 928, status: 0x22 }, // 00928 locking module, driver door
        { code: 1330, status: 0x08 }, // 01330 central control module for comfort system
      ],
    },
  ],
  // Modules the simulated PQ35 gateway reports as installed (addresses), for the TP2.0 scan.
  gatewayInstallList: [0x01, 0x03, 0x08, 0x09, 0x15, 0x17, 0x19, 0x25, 0x46],
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
