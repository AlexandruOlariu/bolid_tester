import { DiagnosticSession } from './DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { getVehicleProfile } from '../../vehicles';
import { ProtocolId } from '../obd/protocols';

interface Case {
  id: string;
  protocol: ProtocolId;
  vin: boolean;
}

const CASES: Case[] = [
  { id: 'generic', protocol: 'ISO_15765_4_CAN_11_500', vin: true },
  { id: 'golf-plus-2009-20tdi', protocol: 'ISO_15765_4_CAN_11_500', vin: true },
  { id: 'fiat-punto-2007-12', protocol: 'ISO_14230_4_KWP_FAST', vin: true },
  { id: 'passat-b55-19tdi', protocol: 'ISO_14230_4_KWP_FAST', vin: false },
];

describe('DiagnosticSession (integration via simulator)', () => {
  for (const c of CASES) {
    it(`${c.id}: connects, identifies, polls, reads & clears DTCs`, async () => {
      const profile = getVehicleProfile(c.id);
      const scenario = buildScenario(c.id, { storedDtcs: ['P0299', 'P0401'] });
      const session = new DiagnosticSession(new MockTransport(scenario), {
        commandTimeoutMs: 1000,
        firstCommandTimeoutMs: 1000,
      });

      const info = await session.connect();
      expect(info.protocol).toBe(c.protocol);

      // The effective PID set equals the profile's expected supported set.
      expect([...session.effectivePids(profile.supportedPids)].sort()).toEqual(
        [...profile.supportedPids].sort(),
      );

      // VIN present on CAN/newer ECUs; absent on the older Passat.
      if (c.vin) expect(info.vin).toHaveLength(17);
      else expect(info.vin).toBeNull();

      // A live value reads sanely.
      const rpm = await session.readValue('010C');
      expect(rpm?.value).toBeCloseTo(820, 0);

      // DTCs read, then clear.
      const stored = await session.readDtcs('03');
      expect(stored.map((d) => d.code).sort()).toEqual(['P0299', 'P0401']);
      expect(await session.clearDtcs()).toBe(true);
      expect(await session.readDtcs('03')).toHaveLength(0);
    });
  }

  it('reads readiness monitors and a freeze frame after a DTC is set', async () => {
    const session = new DiagnosticSession(
      new MockTransport(buildScenario('golf-plus-2009-20tdi', { storedDtcs: ['P0299'] })),
      { commandTimeoutMs: 1000 },
    );
    await session.connect();

    const readiness = await session.readReadiness();
    expect(readiness?.milOn).toBe(true);
    expect(readiness?.dtcCount).toBe(1);
    expect(readiness?.monitors.find((m) => m.id === 'misfire')?.complete).toBe(true);

    const ff = await session.readFreezeFrame(['010C', '0105']);
    expect(ff.triggerDtc).toBe('P0299');
    expect(ff.values.find((v) => v.pid === '010C')?.value).toBeCloseTo(820, 0);
  });

  it('reads the experimental extended PID on the Golf, not on the Passat', async () => {
    const golf = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')), {
      commandTimeoutMs: 1000,
    });
    await golf.connect();
    expect(await golf.readExtended('1701')).toEqual([0x00, 0x2a]);

    const passat = new DiagnosticSession(new MockTransport(buildScenario('passat-b55-19tdi')), {
      commandTimeoutMs: 1000,
    });
    await passat.connect();
    expect(await passat.readExtended('1701')).toBeNull();
  });
});
