import { DiagnosticSession } from './DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { getVehicleProfile } from '../../vehicles';
import { ProtocolId } from '../obd/protocols';
import { codeModule, serviceReset } from '../coding/udsCoding';

interface Case {
  id: string;
  protocol: ProtocolId;
  vin: boolean;
}

const CASES: Case[] = [
  { id: 'generic', protocol: 'ISO_15765_4_CAN_11_500', vin: true },
  { id: 'golf-plus-2009-20tdi', protocol: 'ISO_15765_4_CAN_11_500', vin: true },
  { id: 'fiat-punto-2008-12', protocol: 'ISO_15765_4_CAN_11_500', vin: true },
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

      expect([...session.effectivePids(profile.supportedPids)].sort()).toEqual(
        [...profile.supportedPids].sort(),
      );

      if (c.vin) expect(info.vin).toHaveLength(17);
      else expect(info.vin).toBeNull();

      const rpm = await session.readValue('010C');
      expect(rpm?.value).toBeCloseTo(820, 0);

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

  it('reads Mode 06 monitors on the Golf', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')), {
      commandTimeoutMs: 1000,
    });
    await session.connect();
    const results = await session.readMode06('01');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].mid).toBe(0x01);
    expect(typeof results[0].pass).toBe('boolean');
  });

  it('reads an experimental ABS module sensor on the Golf via custom addressing', async () => {
    const profile = getVehicleProfile('golf-plus-2009-20tdi');
    const sensor = profile.moduleSensors![0];
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')), {
      commandTimeoutMs: 1000,
    });
    await session.connect();
    await session.setHeader(sensor.reqHeader);
    await session.setRxFilter(sensor.rxFilter);
    const data = await session.readExtended(sensor.did);
    expect(data).not.toBeNull();
    expect(typeof sensor.decode(data as number[])).toBe('number');
  });

  it('codes a module on the Golf simulator: backup -> write -> verify', async () => {
    const profile = getVehicleProfile('golf-plus-2009-20tdi');
    const mod = profile.codingModules![0];
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')), {
      commandTimeoutMs: 1000,
    });
    await session.connect();
    await session.setHeader(mod.reqHeader);
    await session.setRxFilter(mod.rxFilter);

    const before = await session.readExtended(mod.codingDid);
    expect(before).toEqual(mod.sampleCoding);

    const newData = mod.sampleCoding.slice();
    newData[0] ^= 0x02;
    const res = await codeModule((cmd) => session.send(cmd), { did: mod.codingDid, newData });
    expect(res.backup).toEqual(mod.sampleCoding);
    expect(res.verified).toBe(true);

    const after = await session.readExtended(mod.codingDid);
    expect(after).toEqual(newData);
  });

  it('resets the service interval on the Golf simulator (routine)', async () => {
    const profile = getVehicleProfile('golf-plus-2009-20tdi');
    const sr = profile.serviceReset!;
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')), {
      commandTimeoutMs: 1000,
    });
    await session.connect();
    await session.setHeader(sr.reqHeader);
    await session.setRxFilter(sr.rxFilter);
    const res = await serviceReset((cmd) => session.send(cmd), {
      method: sr.method,
      routineId: sr.routineId,
    });
    expect(res.ok).toBe(true);
    expect(res.method).toBe('routine');
  });

  it('resets the service interval on the Passat simulator (KWP routine)', async () => {
    const profile = getVehicleProfile('passat-b55-19tdi');
    const sr = profile.serviceReset!;
    expect(sr.transport).toBe('kwp');
    const session = new DiagnosticSession(new MockTransport(buildScenario('passat-b55-19tdi')), {
      commandTimeoutMs: 1000,
    });
    await session.connect();
    await session.setHeader(sr.reqHeader);
    const res = await serviceReset((cmd) => session.send(cmd), {
      transport: sr.transport,
      session: sr.session,
      method: sr.method,
      routineId: sr.routineId,
    });
    expect(res.ok).toBe(true);
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
