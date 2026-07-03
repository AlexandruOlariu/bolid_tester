import { scanTp20, GATEWAY_ADDRESS } from './tp20Scan';
import { FakeTp20Bus, buildTp20BusFromProfile, kwpIdentResponder } from './fakeTp20Bus';
import { getVehicleProfile } from '../../vehicles';

describe('TP2.0 scan against the simulated Golf gateway', () => {
  it('reads the install list and details the profile TP2.0 modules', async () => {
    const bus = buildTp20BusFromProfile(getVehicleProfile('golf-plus-2009-20tdi'));
    const result = await scanTp20(bus, { wanted: [0x19, 0x17, 0x46], timeoutMs: 200 });

    expect(result.installed).toContain(0x17);
    expect(result.installed).toContain(0x46);

    const cluster = result.modules.find((m) => m.address === 0x17);
    expect(cluster?.state).toBe('ok');
    expect(cluster?.ident).toContain('KOMBIINSTRUMENT');

    const comfort = result.modules.find((m) => m.address === 0x46);
    expect(comfort?.state).toBe('ok');
    expect(comfort?.name).toMatch(/comfort/i);
  });

  it('flags a wanted module the gateway does not list as not-installed', async () => {
    const bus = buildTp20BusFromProfile(getVehicleProfile('golf-plus-2009-20tdi'));
    const result = await scanTp20(bus, { wanted: [0x37], timeoutMs: 200 }); // navigation, not fitted
    expect(result.modules[0].state).toBe('not-installed');
  });

  it('defaults to detailing every installed address', async () => {
    const bus = buildTp20BusFromProfile(getVehicleProfile('golf-plus-2009-20tdi'));
    const result = await scanTp20(bus, { timeoutMs: 200 });
    expect(result.modules.length).toBe(result.installed.length);
    expect(GATEWAY_ADDRESS).toBe(0x19);
  });

  it('reads KWP faults per module (comfort has seeded VAG codes, cluster is clean)', async () => {
    const bus = buildTp20BusFromProfile(getVehicleProfile('golf-plus-2009-20tdi'));
    const result = await scanTp20(bus, { wanted: [0x17, 0x46], timeoutMs: 200 });

    const comfort = result.modules.find((m) => m.address === 0x46);
    expect(comfort?.state).toBe('ok');
    expect(comfort?.dtcs?.map((d) => d.vag)).toEqual(['00928', '01330']);

    const cluster = result.modules.find((m) => m.address === 0x17);
    expect(cluster?.state).toBe('ok');
    expect(cluster?.dtcs).toEqual([]); // fault read answered: no faults stored
  });

  it('surfaces a gateway failure but still details the wanted modules directly', async () => {
    // No gateway on the bus at all — install list unavailable.
    const bus = new FakeTp20Bus({
      modules: [
        {
          address: 0x17,
          rxId: 0x717,
          txId: 0x317,
          kwp: kwpIdentResponder('5M0920861B KOMBIINSTRUMENT'),
        },
      ],
    });
    const result = await scanTp20(bus, { wanted: [0x17], timeoutMs: 100 });
    expect(result.gatewayError).toMatch(/gateway/i);
    expect(result.installed).toEqual([]);
    expect(result.modules[0].state).toBe('ok'); // scan degraded, not blanked
  });

  it('flags a module that opens a channel but refuses ident as refused, not silent', async () => {
    const bus = new FakeTp20Bus({
      modules: [
        {
          address: 0x19,
          rxId: 0x719,
          txId: 0x319,
          kwp: kwpIdentResponder('GW'), // minimal gateway so the install-list read fails softly
        },
        {
          address: 0x25,
          rxId: 0x725,
          txId: 0x325,
          kwp: (req) => {
            if (req[0] === 0x18) return [0x58, 0x00];
            return [0x7f, req[0] ?? 0, 0x31]; // immobilizer refuses ident & session
          },
        },
      ],
    });
    const result = await scanTp20(bus, { wanted: [0x25], timeoutMs: 150 });
    expect(result.modules[0].state).toBe('refused');
    expect(result.modules[0].reason).toMatch(/0x31/i);
    expect(result.modules[0].dtcs).toEqual([]); // fault read still worked
  });
});
