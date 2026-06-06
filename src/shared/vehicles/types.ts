/** Vehicle profile types. Profiles are DATA — the engine is generic. See docs/vehicles/README.md. */

import { ProtocolId } from '../obd-core/obd/protocols';

export type Fuel = 'diesel' | 'petrol' | 'lpg' | 'hybrid' | 'other';
export type DtcMode = '03' | '07' | '0A';

/** An experimental manufacturer-specific reading via Mode 22 (UDS readDataByIdentifier). */
export interface ExtendedPid {
  did: string; // data identifier hex, e.g. '1701' → request '221701'
  name: string;
  unit: string;
  experimental: boolean;
  /** Bytes the simulator returns for this DID (after `62 <did>`). */
  sampleResponse: number[];
  decode: (data: number[]) => number;
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
  notes: string;
  testChecklist: string[];
}
