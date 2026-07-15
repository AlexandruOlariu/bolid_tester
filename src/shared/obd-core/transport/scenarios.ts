/** Build a simulator scenario from a vehicle profile. Used by the in-app Settings simulator and by
 *  the tests. See docs/simulator.md. */

import { SimScenario } from './MockTransport';
import { getVehicleProfile } from '../../vehicles';
import { isKLine, ProtocolId } from '../obd/protocols';

const SAMPLE_VINS: Record<string, string> = {
  generic: '1HGBH41JXMN109186',
  'golf-plus-2009-20tdi': 'WVWZZZ1KZ9W903398',
  'fiat-punto-2008-12': 'ZFA19900000438592', // real 199-body (Grande Punto) VIN
  'passat-b55-19tdi': 'WVWZZZ3BZ4E342958',
};

/** Secondary ECUs that answer FUNCTIONAL 0100 / Mode 03 on their OWN line, modelling a real
 *  multi-ECU car (see docs/simulator.md and the Phase 3 / F4 fix in
 *  docs/improvement-plan-2026-07.md). The Punto stands in for the engine+aux-module class that fix
 *  targets: a headers-off functional request returns one line per ECU, which the response parser
 *  must keep as separate frames instead of hex-parsing the concatenation into phantom DTCs/PIDs.
 *
 *  Kept here (not on the typed VehicleProfile) so it is purely a SIMULATOR construct — it does not
 *  claim the physical car has this module; it pins the parsing regression. The secondary's PID set
 *  is a subset of the Punto's, so the discovered UNION is unchanged; it carries no default DTCs, so
 *  it answers `43 00` and cannot perturb the default DTC set. Tests inject secondary DTCs via a
 *  `secondaryEcus` override to exercise the merge path. */
const SIM_SECONDARY_ECUS: Record<string, NonNullable<SimScenario['secondaryEcus']>> = {
  'fiat-punto-2008-12': [{ supportedPids: ['0104', '0105', '010C', '010D', '0111'] }],
};

/** Mode 09 PID 04 calibration identifiers. Passat value is the real one read from the car. */
const SAMPLE_CALIDS: Record<string, string> = {
  generic: 'GENERIC-CAL-01',
  'golf-plus-2009-20tdi': '03L906022LM',
  'fiat-punto-2008-12': '55230047AA',
  'passat-b55-19tdi': '038906019KC 4896',
};

export function buildScenario(profileId: string, overrides: Partial<SimScenario> = {}): SimScenario {
  const profile = getVehicleProfile(profileId);
  const protocol: ProtocolId =
    profile.expectedProtocol === 'AUTO' ? 'ISO_15765_4_CAN_11_500' : profile.expectedProtocol;
  const kline = isKLine(protocol);
  const extendedDids = profile.extendedPids?.length
    ? Object.fromEntries(profile.extendedPids.map((e) => [e.did, e.sampleResponse]))
    : undefined;
  const mode06 = profile.mode06Tests?.length
    ? Object.fromEntries(profile.mode06Tests.map((m) => [m.mid, m.sampleResponse]))
    : undefined;
  const moduleDids = profile.moduleSensors?.length
    ? profile.moduleSensors.reduce<Record<string, Record<string, number[]>>>((acc, s) => {
        (acc[s.reqHeader] ??= {})[s.did] = s.sampleResponse;
        return acc;
      }, {})
    : undefined;
  const adaptationSeeds = profile.adaptations?.length
    ? profile.adaptations.reduce<Record<string, Record<string, number[]>>>((acc, a) => {
        (acc[a.reqHeader] ??= {})[a.did] = a.sampleValue.slice();
        return acc;
      }, {})
    : undefined;
  const udsModules = (profile.modules ?? []).filter((m) => m.transport === 'uds' && m.reqHeader);
  const moduleDtcs = udsModules.length
    ? udsModules.reduce<NonNullable<SimScenario['moduleDtcs']>>((acc, m) => {
        acc[m.reqHeader as string] = (m.sampleDtcs ?? []).map((d) => ({ bytes: [...d.bytes] as [number, number, number], status: d.status }));
        return acc;
      }, {})
    : undefined;
  const moduleIdent = udsModules.length
    ? udsModules.reduce<NonNullable<SimScenario['moduleIdent']>>((acc, m) => {
        if (m.sampleIdent) acc[m.reqHeader as string] = { ...m.sampleIdent };
        return acc;
      }, {})
    : undefined;

  const coding = profile.codingModules?.length
    ? profile.codingModules.reduce<Record<string, Record<string, number[]>>>((acc, m) => {
        (acc[m.reqHeader] ??= {})[m.codingDid] = m.sampleCoding.slice();
        return acc;
      }, {})
    : undefined;

  // Seed the car's real, known faults (from its diagnostic history) so the default scenario is
  // realistic. Callers — the tests and the in-app DTC injector — can still override any DTC store.
  const known = profile.knownFaults ?? [];
  const faultCodes = (kind: 'stored' | 'pending' | 'permanent') =>
    known.filter((f) => (f.kind ?? 'stored') === kind).map((f) => f.code);

  // IUPR seeds (CAN cars): plausible driven-car counters; diesel -> 090B, petrol -> 0908.
  const item = (n: number) => [Math.floor(n / 256), n % 256];
  const iuprCompression = !kline && profile.fuel === 'diesel'
    ? [0x10, ...item(1500), ...item(1800), ...item(300), ...item(400), ...item(250), ...item(400),
       ...item(0), ...item(0), ...item(120), ...item(140), ...item(400), ...item(410),
       ...item(390), ...item(400), ...item(380), ...item(400)]
    : undefined;
  const iuprSpark = !kline && profile.fuel !== 'diesel'
    ? [0x10, ...item(900), ...item(1000), ...item(400), ...item(500), ...item(0), ...item(0),
       ...item(420), ...item(500), ...item(0), ...item(0), ...item(380), ...item(500),
       ...item(0), ...item(0), ...item(200), ...item(500)]
    : undefined;

  const monitorFrames = kline
    ? ['48 6B 10 41 0C 0C D0 5A']
    : [
        '7E8 04 41 0C 0C D0',
        '1A0 08 12 34 56 78 9A BC DE F0',
        '2C3 04 00 11 22 33',
        '7E8 03 41 0D 00',
        '5D0 05 AA BB CC DD EE',
      ];

  const base: SimScenario = {
    protocol,
    supportedPids: profile.supportedPids,
    vin: SAMPLE_VINS[profileId] ?? SAMPLE_VINS.generic,
    // The B5.5's ECU does answer Mode 09 (VIN + Calibration ID) — confirmed on the real car.
    vinSupported: true,
    calibrationId: SAMPLE_CALIDS[profileId],
    storedDtcs: faultCodes('stored'),
    pendingDtcs: faultCodes('pending'),
    permanentDtcs: faultCodes('permanent'),
    extendedDids,
    mode06,
    moduleDids,
    coding: mergeCoding(coding, adaptationSeeds),
    moduleDtcs,
    moduleIdent,
    iuprSpark,
    iuprCompression,
    monitorFrames,
    secondaryEcus: SIM_SECONDARY_ECUS[profileId],
    latencyMs: kline ? 5 : 0,
    emitSearching: kline,
  };
  return { ...base, ...overrides };
}

function mergeCoding(
  a?: Record<string, Record<string, number[]>>,
  b?: Record<string, Record<string, number[]>>,
): Record<string, Record<string, number[]>> | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: Record<string, Record<string, number[]>> = {};
  for (const src of [a, b]) {
    for (const [header, dids] of Object.entries(src)) {
      out[header] = { ...(out[header] ?? {}), ...dids };
    }
  }
  return out;
}
