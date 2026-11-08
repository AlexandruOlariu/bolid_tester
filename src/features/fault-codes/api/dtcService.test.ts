/** dtcService (plan 05): the core session read is generic, so manufacturer-specific codes only get
 *  their VAG / Fiat text when the service re-describes them with the selected profile's `make`.
 *  Runs the real service against the simulator; the persisted stores' file system is mocked. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { DiagnosticSession } from '@/shared/obd-core';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { lookupDtc } from '@/shared/obd-core/obd/dtc';
import { describeForMake, readAll } from './dtcService';

async function connectSim(profileId: string, storedDtcs: string[]) {
  const session = new DiagnosticSession(
    new MockTransport(buildScenario(profileId, { storedDtcs, pendingDtcs: [], permanentDtcs: [] })),
  );
  const info = await session.connect();
  useSessionStore.getState().setConnected(session, info, { id: 'mock', name: 'Simulator' });
  useVehicleStore.setState({ selectedProfileId: profileId });
}

beforeEach(() => {
  useSessionStore.getState().reset();
  useVehicleStore.setState({ selectedProfileId: 'generic' });
});

describe('describeForMake', () => {
  it('uses the make table for manufacturer codes and the SAE table for generic ones', () => {
    const list = [
      { code: 'P1557', description: 'whatever the session said' },
      { code: 'P0135', description: 'x' },
    ];
    const vag = describeForMake(list, 'vag');
    expect(vag[0].description).toMatch(/charge pressure/i);
    expect(vag[1].description).toMatch(/O2 Sensor Heater/i);
    expect(describeForMake(list, undefined)[0].description).toMatch(/^Powertrain — .*P1557/);
  });
});

describe('readAll against the simulator', () => {
  it('shows the VAG text for a VAG P1 code on the Golf', async () => {
    await connectSim('golf-plus-2009-20tdi', ['P1557', 'P0301']);
    const result = await readAll();
    expect(result).not.toBeNull();
    const byCode = Object.fromEntries(result!.stored.map((d) => [d.code, d.description]));
    expect(byCode.P1557).toMatch(/charge pressure/i);
    expect(byCode.P0301).toMatch(/Cylinder 1 Misfire Detected/);
  });

  it('describes the Settings → Custom… QA set P0135,P0301,U0121 (severity high for P0301)', async () => {
    await connectSim('generic', ['P0135', 'P0301', 'U0121']);
    const result = await readAll();
    expect(result!.stored.map((d) => d.code)).toEqual(['P0135', 'P0301', 'U0121']);
    for (const d of result!.stored) {
      expect(d.description).not.toMatch(/no local description/);
      expect(lookupDtc(d.code).source).toBe('generic');
    }
    expect(lookupDtc('P0301').severity).toBe('high');
    expect(lookupDtc('U0121').severity).toBe('moderate');
  });

  it('keeps the range description for the same code on the generic profile', async () => {
    await connectSim('generic', ['P1557', 'U0121']);
    const result = await readAll();
    const byCode = Object.fromEntries(result!.stored.map((d) => [d.code, d.description]));
    expect(byCode.P1557).toMatch(/P1557/);
    expect(byCode.P1557).not.toMatch(/charge pressure/i);
    expect(byCode.U0121).toMatch(/Lost Communication With Anti-Lock Brake/);
  });
});
