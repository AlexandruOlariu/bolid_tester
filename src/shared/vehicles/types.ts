/** Vehicle profile types. Profiles are DATA — the engine is generic. See docs/vehicles/README.md. */

import { ProtocolId } from '../obd-core/obd/protocols';

export type Fuel = 'diesel' | 'petrol' | 'lpg' | 'hybrid' | 'other';
export type DtcMode = '03' | '07' | '0A';

/** An experimental manufacturer-specific reading via Mode 22 (UDS readDataByIdentifier). */
export interface ExtendedPid {
  did: string; // data identifier hex, e.g. '1701' -> request '221701'
  name: string;
  unit: string;
  experimental: boolean;
  /** Optional grouping for feature screens — the DPF/diesel monitor filters to 'dpf' | 'diesel';
   *  the sensor-readings screen surfaces 'injection' DIDs in its injection section. */
  category?: 'general' | 'diesel' | 'dpf' | 'injection';
  /** Optional semantic role so a feature can map a DID to a known quantity (DPF soot, EGT, …). */
  role?:
    | 'sootPct'
    | 'sootMassG'
    | 'ashMassG'
    | 'kmSinceRegen'
    | 'regenCount'
    | 'egtC'
    | 'oilTempC'
    | 'egrPct';
  /** Bytes the simulator returns for this DID (after `62 <did>`). */
  sampleResponse: number[];
  decode: (data: number[]) => number;
}

/** A standardized Mode 06 monitor we surface for this car. sampleResponse is the full response
 *  (including the 0x46 service byte) the simulator returns for request 06<mid>. */
export interface Mode06Test {
  mid: string; // monitor id hex, e.g. '01'
  name: string;
  sampleResponse: number[];
}

/** An EXPERIMENTAL non-powertrain module sensor read via UDS 22 with custom CAN addressing.
 *  CAN only; per-car and unverified. See docs/features/sensor-tests.md. */
export interface ModuleSensor {
  module: string; // e.g. 'ABS'
  reqHeader: string; // tester->module CAN id for ATSH, e.g. '760'
  rxFilter: string; // ATCRA filter, e.g. '768'
  did: string; // data identifier hex
  name: string;
  unit: string;
  experimental: true;
  sampleResponse: number[]; // bytes the simulator returns after 62 <did>
  decode: (data: number[]) => number;
}

/** An EXPERIMENTAL codeable module. Ships DISABLED; see docs/features/coding.md for the safety
 *  model. */
export interface CodingModule {
  module: string;
  reqHeader: string;
  rxFilter: string;
  codingDid: string;
  byteCount: number;
  schema: { byte: number; bit?: number; mask?: number; name: string }[];
  sampleCoding: number[]; // simulator's stored coding
  security?: { level: number };
  experimental: true;
}

/** An EXPERIMENTAL service-interval ("oil service / SRI") reset descriptor for a module (usually the
 *  instrument cluster). CAN only; per-car; see docs/features/service-reset.md. */
export interface ServiceReset {
  module: string;
  reqHeader: string;
  rxFilter: string;
  /** 'uds' (CAN, ISO 14229) or 'kwp' (K-line, ISO 14230 / KWP2000). Defaults to 'uds'. */
  transport?: 'uds' | 'kwp';
  /** Diagnostic session byte to enter (0x03 extended for UDS, often 0x85/0x89 for KWP). */
  session?: number;
  method: 'routine' | 'adaptation';
  /** For method 'routine': UDS RoutineControl id (4 hex), started with sub-function 0x01. */
  routineId?: string;
  /** For method 'adaptation': DIDs whose service values are written back to default. */
  adaptations?: { did: string; defaultBytes: number[] }[];
  /** SecurityAccess this reset needs. `level` alone documents the requirement; the ECU is only
   *  actually unlocked when `seedToKey` is also supplied (the algorithm is per-ECU and not shipped
   *  by default). Without it the reset is attempted unlocked and a real module that needs access
   *  answers NRC 0x33 — the UI explains that. */
  security?: { level: number; seedToKey?: (seed: number[]) => number[] };
  /** Manual fallback steps (e.g. dash-stalk SRI reset) shown to the user. Surfaced always, and
   *  especially when the adapter cannot reach the target module (generic ELM327 K-line clusters). */
  manualProcedure?: string[];
  /** Set when the OBD path is KNOWN not to work on the real car over a generic ELM327 (e.g. the
   *  target module speaks KWP1281, which an ELM327 cannot address). The value is the honest,
   *  user-facing reason. The UI then leads with `manualProcedure` and demotes the OBD attempt to
   *  an explicit "try anyway". The simulator still answers, so the flow stays testable. */
  obdUnreachable?: string;
  experimental: true;
}

/** An EXPERIMENTAL adaptation channel (VCDS-style "adaptation"): a small numeric module value
 *  read via UDS 22 and written via 2E, with backup + verify. Bounds are on the DISPLAY value
 *  (raw*scale+offset). Channels with `security` are read-only unless the profile supplies a
 *  seed/key algorithm. See docs/features/adaptations.md. */
export interface AdaptationChannel {
  module: string;
  reqHeader: string;
  rxFilter: string;
  did: string;
  name: string;
  unit?: string;
  byteCount: number;
  scale?: number;
  offset?: number;
  min?: number;
  max?: number;
  /** Known default raw bytes, offered as a one-tap restore-to-default. */
  defaultRaw?: number[];
  security?: { level: number };
  experimental: true;
  /** Simulator seed (mutable in the sim via 2E, like coding). */
  sampleValue: number[];
}

/** An EXPERIMENTAL guided routine: a UDS output test (2F) or basic setting (31) with explicit
 *  interlocks the app checks live before starting. See docs/features/routines.md. */
export interface GuidedRoutine {
  module: string;
  reqHeader: string;
  rxFilter: string;
  kind: 'outputTest' | 'basicSetting';
  service: '2F' | '31';
  /** RoutineControl id (31) or IO-control DID (2F). */
  id: string;
  name: string;
  /** What it does + what the user should expect/observe. Shown before the confirm. */
  description: string;
  /** VCDS measuring-block "Basic Settings" group this maps to (e.g. 121), when known from a real
   *  scan. Documentation/cross-reference only — VCDS hides the raw bus request behind its label
   *  file, so this does NOT give the UDS routine id / KWP sequence; it anchors what to look for. */
  vcdsGroup?: number;
  controlData?: number[];
  session?: number;
  /** Live values (profile extendedPids DIDs) polled and shown while the routine runs. */
  liveDids?: string[];
  /** Checked immediately before start, from live data. */
  interlocks: {
    requireEngineOff?: boolean;
    requireIdle?: boolean;
    maxSpeedKmh?: number;
  };
  /** SecurityAccess this routine needs. `level` alone documents the requirement; the ECU is only
   *  actually unlocked when `seedToKey` is also supplied (the algorithm is per-ECU and not shipped
   *  by default). Without it the routine is attempted unlocked and a real module that needs access
   *  answers NRC 0x33 — the UI explains that. */
  security?: { level: number; seedToKey?: (seed: number[]) => number[] };
  /** Set when the routine is KNOWN not to be executable over the app's current transport on the real
   *  car (e.g. it is a VCDS measuring-block "Basic Settings" that rides on VW TP2.0 / KWP, which a
   *  generic ELM327 cannot drive and the app's TP2.0 transport does not yet implement). Mirrors
   *  `ServiceReset.obdUnreachable`: the UI leads with this reason and demotes the start to an
   *  explicit "attempt anyway (unverified)". The simulator still answers, so the flow stays
   *  demoable. */
  unavailableReason?: string;
  experimental: true;
}

/** A diagnosable control module for the per-module scan ("auto-scan"). UDS modules are addressed
 *  directly over ISO-TP (ATSH/ATCRA); 'tp20' modules are pre-UDS VAG modules reached through the
 *  TP2.0 gateway scan (see docs/features/module-scan.md and docs/features/tp20.md) rather than
 *  the per-header UDS loop. Addressing and sample data are per-car and, unless noted, illustrative. */
export interface DiagModule {
  /** VAG two-digit diagnostic address as VCDS shows it, e.g. '01' engine, '03' ABS, '17' cluster. */
  address: string;
  name: string;
  transport: 'uds' | 'tp20';
  /** UDS only: tester->module CAN id (ATSH) and reply filter (ATCRA). */
  reqHeader?: string;
  rxFilter?: string;
  experimental: boolean;
  /** Simulator seeds: 3-byte UDS DTCs + ISO 14229 status, and ident DID -> ASCII value. */
  sampleDtcs?: { bytes: [number, number, number]; status: number }[];
  sampleIdent?: Record<string, string>;
  /** TP2.0 modules: the VAG logical address to open a channel to, and a sample ident string the
   *  simulated bus returns (KWP 0x1A). */
  tp20Address?: number;
  tp20SampleIdent?: string;
  /** TP2.0 modules: sample KWP faults the simulated bus returns (KWP 0x18). `code` is the VAG
   *  5-digit code as a number (decimal of the 2-byte DTC, e.g. 928 → 00928); `status` the KWP
   *  status byte. Illustrative, like the UDS sampleDtcs. */
  tp20SampleDtcs?: { code: number; status?: number }[];
}

/** A fault this exact car is known to report, taken from real diagnostic history (VCDS / OBD2
 *  scans). This documents the car and lets the simulator seed a realistic DTC set — it is per-car
 *  ground truth, NOT the generic DTC dictionary in obd-core/obd/dtc.ts. */
export interface KnownFault {
  /** Generic OBD-II code as the engine ECU reports it over Mode 03/07/0A, e.g. 'P2183'. */
  code: string;
  /** Manufacturer (VAG) 5-digit code for the same fault, if known, e.g. '08579'. For VAG this is
   *  just the DTC's two raw bytes read as a decimal number — see `vagCodeForDtc` in obd/dtc.ts. */
  vagCode?: string;
  description: string;
  /** Which DTC store the simulator should place it in. Defaults to 'stored' (Mode 03). */
  kind?: 'stored' | 'pending' | 'permanent';
  /** Observed real-world behaviour (e.g. persistence across scans), for docs/UI. */
  note?: string;
}

export interface VehicleProfile {
  id: string;
  name: string;
  year: number;
  engine: string;
  fuel: Fuel;
  /** Hint only — the adapter still auto-detects the real protocol. */
  expectedProtocol: ProtocolId;
  /** VIN prefixes that identify this car/family (e.g. 'WVWZZZ1K'). Drives the connect-time
   *  "VIN matches <profile>" suggestion in vehicle-select. */
  vinPatterns?: string[];
  /** Mode 01 PIDs we surface for this car (request strings, e.g. '010C'). */
  supportedPids: string[];
  dtcModes: DtcMode[];
  /** Faults this exact car is known to report, from real diagnostic history (VCDS/OBD2). Documents
   *  the car and seeds the simulator (transport/scenarios.ts). Omitted for generic profiles. */
  knownFaults?: KnownFault[];
  extendedPids?: ExtendedPid[];
  /** Standardized Mode 06 monitors (any OBD2 car may support these). */
  mode06Tests?: Mode06Test[];
  /** Experimental, CAN-only module sensor reads (e.g. ABS wheel speed). */
  moduleSensors?: ModuleSensor[];
  /** Experimental, CAN-only codeable modules. Disabled by default in the UI. */
  codingModules?: CodingModule[];
  /** Experimental, CAN-only service-interval reset descriptor. */
  serviceReset?: ServiceReset;
  /** Control modules for the per-module scan (auto-scan). See docs/features/module-scan.md. */
  modules?: DiagModule[];
  /** Addresses the (simulated) gateway reports installed — drives the TP2.0 scan. */
  gatewayInstallList?: number[];
  /** Experimental, CAN-only adaptation channels. See docs/features/adaptations.md. */
  adaptations?: AdaptationChannel[];
  /** Experimental, CAN-only guided routines (output tests / basic settings). */
  routines?: GuidedRoutine[];
  notes: string;
  testChecklist: string[];
}
