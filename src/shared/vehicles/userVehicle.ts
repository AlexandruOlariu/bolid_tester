/** User vehicles ("My garage", plan 06): cars the user added on this phone, either learned from a
 *  live connection (VIN, protocol, supported-PID set, calibration id) or entered by hand. They are
 *  not registry profiles — no TypeScript, no Markdown, no sync test. Each one inherits everything it
 *  does not know from a registry profile (`baseProfileId`, `generic` by default) and is turned into a
 *  runtime `VehicleProfile` by `buildUserProfile`. Pure; see docs/vehicles/README.md → "User
 *  vehicles vs registry profiles". */

import type { ProtocolId } from '../obd-core/obd/protocols';
import type { DtcMake } from '../obd-core/obd/dtcDatabase';
import type { SessionInfo } from '../obd-core/session/DiagnosticSession';
import { decodeVin } from '../obd-core/obd/vinDecode';
import type { DiagModule, Fuel, LoginCodeEntry, VehicleProfile } from './types';

/** What a live connection told us about the car. */
export interface LearnedIdentity {
  protocol: ProtocolId;
  /** Observed Mode 01 set (from `SessionInfo.supportedPids`). */
  supportedPids: string[];
  vin: string | null;
  calibrationId: string | null;
  adapterVersion?: string;
  learnedAt: number;
}

export interface UserVehicle {
  /** `user:<random>` — never collides with a registry id. */
  id: string;
  /** Display name, e.g. "Dacia Logan 2015". */
  name: string;
  year?: number;
  fuel: Fuel;
  make?: DtcMake;
  /** Registry profile to inherit everything else from (extended PIDs, modules, routines…). */
  baseProfileId: string;
  learned?: LearnedIdentity;
  notes?: string;
  /** The car's code book (plan 22): module login codes the user chose to remember. */
  loginCodes?: LoginCodeEntry[];
  /** Modules the user added from **Discover modules** (plan 25), merged over the base profile's
   *  module list by `buildUserProfile` (a user entry replaces the base's with the same transport +
   *  address). */
  modules?: DiagModule[];
  createdAt: number;
  updatedAt: number;
}

/** Longest garage-car name and notes (the editor's input caps; also the `bolid.profile.v1` schema
 *  limits, so every car the garage holds exports to a file that imports again — plan 13). */
export const VEHICLE_NAME_MAX = 80;
export const VEHICLE_NOTES_MAX = 4000;

/** Prefix of every user-vehicle id. */
export const USER_VEHICLE_PREFIX = 'user:';

export const isUserVehicleId = (id: string): boolean => id.startsWith(USER_VEHICLE_PREFIX);

/** Build the runtime profile of a user vehicle: identity from the user record, protocol and PID set
 *  from the learned identity when there is one, everything else from `base`. The per-car
 *  experimental arrays (extended PIDs, modules, coding, routines…) are copied only from a
 *  non-generic base — picking the Golf as a base is an explicit opt-in to the Golf's illustrative
 *  data; the generic base has none to give. Known faults and the test checklist are never inherited:
 *  they describe the registry car, not this one. */
export function buildUserProfile(user: UserVehicle, base: VehicleProfile): VehicleProfile {
  const learned = user.learned;
  const profile: VehicleProfile = {
    id: user.id,
    baseProfileId: base.id,
    name: user.name,
    year: user.year ?? base.year,
    engine: base.id === 'generic' ? '—' : base.engine,
    fuel: user.fuel,
    make: user.make ?? base.make,
    expectedProtocol: learned?.protocol ?? base.expectedProtocol,
    vinPatterns: learned?.vin ? [learned.vin.slice(0, 8)] : base.vinPatterns,
    supportedPids: learned?.supportedPids ?? base.supportedPids,
    dtcModes: base.dtcModes,
    notes: user.notes ?? '',
    testChecklist: [],
  };
  if (base.id !== 'generic') {
    if (base.extendedPids) profile.extendedPids = base.extendedPids;
    if (base.modules) profile.modules = base.modules;
    if (base.adaptations) profile.adaptations = base.adaptations;
    if (base.loginCodes) profile.loginCodes = base.loginCodes;
    if (base.routines) profile.routines = base.routines;
    if (base.codingModules) profile.codingModules = base.codingModules;
    if (base.codingPresets) profile.codingPresets = base.codingPresets;
    if (base.serviceReset) profile.serviceReset = base.serviceReset;
    if (base.moduleSensors) profile.moduleSensors = base.moduleSensors;
    if (base.mode06Tests) profile.mode06Tests = base.mode06Tests;
    if (base.boost) profile.boost = base.boost;
    if (base.gatewayInstallList) profile.gatewayInstallList = base.gatewayInstallList;
  }
  // Discovered modules apply on ANY base — discovery is how a generic-base car gets a module map.
  if (user.modules?.length) profile.modules = mergeModules(profile.modules ?? [], user.modules);
  return profile;
}

/** A module's identity in a module list: transport + VAG address. The same address can appear
 *  once per transport (the Golf lists cluster `17` on UDS and on TP2.0), so anything that keys
 *  modules (scan results, Clear, React keys) uses this, never the address alone. */
export const diagModuleKey = (m: Pick<DiagModule, 'transport' | 'address'>): string =>
  `${m.transport}:${m.address.toUpperCase()}`;

/** `base` with every `extra` module added; an extra replaces a base entry with the same transport
 *  and address (in place), so a discovered address overrides the profile's illustrative one. */
export function mergeModules(base: DiagModule[], extra: DiagModule[]): DiagModule[] {
  const out = base.slice();
  for (const m of extra) {
    const i = out.findIndex((x) => diagModuleKey(x) === diagModuleKey(m));
    if (i >= 0) out[i] = m;
    else out.push(m);
  }
  return out;
}

const HEX_ID = /^[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{5})?$/;

/** Keep only well-formed user modules from persisted data (UDS with a request header and reply
 *  filter, or TP2.0 with a logical address); undefined when none survive. */
export function sanitizeUserModules(raw: unknown): DiagModule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DiagModule[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const m = x as Partial<DiagModule>;
    if (typeof m.address !== 'string' || !/^[0-9A-Fa-f]{2}$/.test(m.address)) continue;
    if (typeof m.name !== 'string' || typeof m.experimental !== 'boolean') continue;
    if (m.transport === 'uds') {
      if (typeof m.reqHeader !== 'string' || !HEX_ID.test(m.reqHeader)) continue;
      if (typeof m.rxFilter !== 'string' || !HEX_ID.test(m.rxFilter)) continue;
      out.push({
        address: m.address,
        name: m.name,
        transport: 'uds',
        reqHeader: m.reqHeader,
        rxFilter: m.rxFilter,
        experimental: m.experimental,
      });
    } else if (m.transport === 'tp20' && typeof m.tp20Address === 'number') {
      out.push({
        address: m.address,
        name: m.name,
        transport: 'tp20',
        tp20Address: m.tp20Address,
        experimental: m.experimental,
      });
    }
  }
  return out.length ? out : undefined;
}

/** Registry id whose per-car curated data (fault guides) applies to `profile`: its own id for a
 *  registry profile, the base profile's id for a garage car. */
export function curatedProfileId(profile: VehicleProfile): string {
  return profile.baseProfileId ?? profile.id;
}

/** The profile PID list the live poll intersects the ECU-supported set with
 *  (`DiagnosticSession.effectivePids`), or undefined for "no filter — poll every PID the ECU
 *  reports". Auto / Generic and every garage car on the generic base take no filter: generic's
 *  `supportedPids` is a placeholder list, not a curated one, so a car added by hand on the generic
 *  base must not be cut down to it (and a learned one's list is the ECU set anyway). */
export function livePidFilter(profile: VehicleProfile): string[] | undefined {
  return curatedProfileId(profile) === 'generic' ? undefined : profile.supportedPids;
}

/** Pure extraction of a learned identity from a live `SessionInfo`. */
export function learnedFromSessionInfo(
  info: SessionInfo,
  now: number = Date.now(),
): LearnedIdentity {
  return {
    protocol: info.protocol,
    supportedPids: [...info.supportedPids],
    vin: info.vin,
    calibrationId: info.calibrationId,
    ...(info.version ? { adapterVersion: info.version } : {}),
    learnedAt: now,
  };
}

/** Manufacturer name (`decodeVin`) of a VIN, or null when the WMI is not in the table. */
function knownManufacturer(vin: string | null): string | null {
  if (!vin) return null;
  const m = decodeVin(vin).manufacturer;
  return m.startsWith('Unknown') ? null : m;
}

/** Model year of a VIN (char 10), or null when it is not encoded (common on European VINs). */
export function vinModelYear(vin: string | null): number | null {
  if (!vin) return null;
  const d = decodeVin(vin);
  return d.validFormat ? d.modelYear : null;
}

/** Default display name from a VIN ("Volkswagen 2009", "Fiat"), or "My car". */
export function defaultVehicleName(vin: string | null): string {
  const maker = knownManufacturer(vin);
  if (!maker) return 'My car';
  const year = vinModelYear(vin);
  return year ? `${maker} ${year}` : maker;
}

const VAG_MAKERS = ['Volkswagen', 'Audi', 'Škoda', 'SEAT'];
const FIAT_MAKERS = ['Fiat', 'Alfa Romeo', 'Lancia'];

/** Manufacturer DTC table for a VIN: VW / Audi / SEAT / Škoda → `vag`, Fiat / Alfa Romeo / Lancia →
 *  `fiat`, anything else → undefined (generic texts only). */
export function makeForVin(vin: string | null): DtcMake | undefined {
  const maker = knownManufacturer(vin);
  if (!maker) return undefined;
  if (VAG_MAKERS.some((m) => maker.startsWith(m))) return 'vag';
  if (FIAT_MAKERS.some((m) => maker.startsWith(m))) return 'fiat';
  return undefined;
}

/** Last five VIN characters, the per-car suffix shown on chips ("03398"), or null. */
export function vinSuffix(vin: string | null | undefined): string | null {
  return vin && vin.length >= 5 ? vin.slice(-5) : null;
}

/** Pick the garage vehicle whose learned VIN equals the connected car's VIN (case- and
 *  space-insensitive), for the connect-time auto-select. Returns null when the VIN is missing or no
 *  garage car was learned with it. When several match, the most recently updated wins. */
export function pickVehicleForVin(
  vin: string | null | undefined,
  vehicles: UserVehicle[],
): UserVehicle | null {
  const norm = (v: string) => v.replace(/\s+/g, '').toUpperCase();
  if (!vin || norm(vin).length === 0) return null;
  const target = norm(vin);
  const hits = vehicles.filter((v) => v.learned?.vin && norm(v.learned.vin) === target);
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
}
