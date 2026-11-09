import { DiagnosticSession, MockTransport, buildScenario, isCan } from '@/shared/obd-core';
import { decodeExtendedSnapshot } from './extendedSnapshot';
import { computePollPids, planSweep } from './pollPids';
import { getVehicleProfile, type ExtendedPid } from '@/shared/vehicles';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const defs: ExtendedPid[] = golf.extendedPids ?? [];

describe('decodeExtendedSnapshot', () => {
  it("decodes through the profile's decoder and applies ts", () => {
    const out = decodeExtendedSnapshot({ '1701': [0x04, 0xb0], '1707': [0x82] }, defs, 1234);
    expect(out['22:1701']).toEqual({
      pid: '22:1701',
      name: 'DPF soot mass (calc.)',
      unit: 'g',
      value: 12,
      ts: 1234,
    });
    expect(out['22:1707']?.value).toBe(90);
    expect(out['22:1707']?.ts).toBe(1234);
  });

  it('omits a DID without a definition and one with null bytes', () => {
    const out = decodeExtendedSnapshot({ ABCD: [1, 2], '1702': null }, defs, 1);
    expect(out).toEqual({});
  });

  it('omits a DID whose decoder fails', () => {
    const bad: ExtendedPid = { ...defs[0], did: 'EEEE', decode: () => NaN };
    expect(decodeExtendedSnapshot({ EEEE: [1] }, [bad], 1)).toEqual({});
  });
});

describe('one EngineHost-equivalent sweep on the Golf simulator', () => {
  it('reads 010C and 22:1701 in the same snapshot', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario(golf.id)));
    const info = await session.connect();
    const keys = computePollPids({
      registrations: { chart: ['22:1701', '010C'] },
      alertPids: [],
      tripPids: [],
    });
    const { pids, dids } = planSweep(
      keys,
      defs.map((d) => d.did),
      isCan(info.protocol),
    );
    expect(dids).toEqual(['1701']);
    const snap = await session.pollOnce(pids);
    const ext = decodeExtendedSnapshot(await session.pollExtendedOnce(dids), defs, Date.now());
    const merged = { ...snap, ...ext };
    expect(merged['010C']?.value).toBeCloseTo(820, 0);
    expect(merged['22:1701']?.value).toBe(12);
  });
});
