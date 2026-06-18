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
  const coding = profile.codingModules?.length
    ? profile.codingModules.reduce<Record<string, Record<string, number[]>>>((acc, m) => {
        (acc[m.reqHeader] ??= {})[m.codingDid] = m.sampleCoding.slice();
        return acc;
      }, {})
    : undefined;

  const base: SimScenario = {
    protocol,
    supportedPids: profile.supportedPids,
    vin: SAMPLE_VINS[profileId] ?? SAMPLE_VINS.generic,
    // The B5.5's ECU does answer Mode 09 (VIN + Calibration ID) — confirmed on the real car.
    vinSupported: true,
    calibrationId: SAMPLE_CALIDS[profileId],
    storedDtcs: [],
    pendingDtcs: [],
    permanentDtcs: [],
    extendedDids,
    mode06,
    moduleDids,
    coding,
    latencyMs: kline ? 5 : 0,
    emitSearching: kline,
  };
  return { ...base, ...overrides };
}
