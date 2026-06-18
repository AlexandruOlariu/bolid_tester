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
  security?: { level: number };
  /** Manual fallback steps (e.g. dash-stalk SRI reset) shown to the user. Surfaced always, and
   *  especially when the adapter cannot reach the target module (generic ELM327 K-line clusters). */
  manualProcedure?: string[];
  experimental: true;
}

export interface VehicleProfile {
  id: string;
  name: string;
  year: number;
  engine: string;
  fuel: Fuel;
  /** Hint only — the adapter still auto-detects the real protocol. */
  expectedProtocol: ProtocolId;
  /** Mode 01 PIDs we surface for this car (request strings, e.g. '010C'). */
  supportedPids: string[];
  dtcModes: DtcMode[];
  extendedPids?: ExtendedPid[];
  /** Standardized Mode 06 monitors (any OBD2 car may support these). */
  mode06Tests?: Mode06Test[];
  /** Experimental, CAN-only module sensor reads (e.g. ABS wheel speed). */
  moduleSensors?: ModuleSensor[];
  /** Experimental, CAN-only codeable modules. Disabled by default in the UI. */
  codingModules?: CodingModule[];
  /** Experimental, CAN-only service-interval reset descriptor. */
  serviceReset?: ServiceReset;
  notes: string;
  testChecklist: string[];
}
