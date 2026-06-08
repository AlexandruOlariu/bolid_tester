/** Build a simulator scenario from a vehicle profile. Used by the in-app Settings simulator and by
 *  the tests. See docs/simulator.md. */

import { SimScenario } from './MockTransport';
import { getVehicleProfile } from '../../vehicles';
import { isKLine, ProtocolId } from '../obd/protocols';

const SAMPLE_VINS: Record<string, string> = {
  generic: '1HGBH41JXMN109186',
  'golf-plus-2009-20tdi': 'WVWZZZ1KZ9W000001',
  'fiat-punto-2008-12': 'ZFA19900000438592', // real 199-body (Grande Punto) VIN
  'passat-b55-19tdi': 'WVWZZZ3BZ4E000001',
};

export function buildScenario(profileId: string, overrides: Partial<SimScenario> = {}): SimScenario {
  const profile = getVehicleProfile(profileId);
  const protocol: ProtocolId =
    profile.expectedProtocol === 'AUTO' ? 'ISO_15765_4_CAN_11_500' : profile.expectedProtocol;
  const kline = isKLine(protocol);
  const extendedDids = profile.extendedPids?.length
    ? Object.fromEntries(profile.extendedPids.map((e) => [e.did, e.sampleResponse]))
    : undefined;

  const base: SimScenario = {
    protocol,
    supportedPids: profile.supportedPids,
    vin: SAMPLE_VINS[profileId] ?? SAMPLE_VINS.generic,
    // Emulate older ECUs (the Passat) that don't answer Mode 09 VIN.
    vinSupported: profileId !== 'passat-b55-19tdi',
    storedDtcs: [],
    pendingDtcs: [],
    permanentDtcs: [],
    extendedDids,
    latencyMs: kline ? 5 : 0,
    emitSearching: kline,
  };
  return { ...base, ...overrides };
}
