/** Integration: multi-PID batching, per-code freeze frames and IUPR against the simulator. */
import { DiagnosticSession } from './DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';

describe('session extras against the simulator', () => {
  it('batches Mode 01 PIDs on the CAN Golf and matches serial results', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await session.connect();
    const pids = ['010C', '0105', '010B', '010D', '010F', '0111', '0104'];
    const batched = await session.pollOnce(pids);
    expect(batched['010C']?.value).toBeCloseTo(820, 0);
    expect(batched['0105']?.value).toBe(85);
    expect(batched['0104']?.value).toBeCloseTo(25.1, 1);
    expect(Object.keys(batched).length).toBeGreaterThanOrEqual(6);
  });

  it('stays serial on the K-line Passat and still returns values', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('passat-b55-19tdi')));
    await session.connect();
    const out = await session.pollOnce(['010C', '0105']);
    expect(out['010C']?.value).toBeCloseTo(820, 0);
  });

  it('reads one freeze frame per stored DTC on the Golf', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await session.connect();
    const frames = await session.readFreezeFrames();
    expect(frames.length).toBe(3); // P2183, P2015, P0121
    expect(frames.map((f) => f.triggerDtc)).toEqual(['P2183', 'P2015', 'P0121']);
    expect(frames[0].frame).toBe(0);
    expect(frames[1].values.length).toBeGreaterThan(0);
  });

  it('reads diesel IUPR (090B) on the Golf and none on the K-line Passat', async () => {
    const golf = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await golf.connect();
    const report = await golf.readIupr();
    expect(report?.variant).toBe('compression');
    expect(report?.ignitionCycles).toBe(1800);
    expect(report?.monitors[3].name).toBe('PM filter');

    const passat = new DiagnosticSession(new MockTransport(buildScenario('passat-b55-19tdi')));
    await passat.connect();
    expect(await passat.readIupr()).toBeNull();
  });

  it('serves Mode 05 only off-CAN', async () => {
    const scenario = buildScenario('passat-b55-19tdi', {
      mode05: { '0101': [0x45, 0x01, 0x01, 0x64] },
    });
    const passat = new DiagnosticSession(new MockTransport(scenario));
    await passat.connect();
    const r = await passat.readMode05('01', '01');
    expect(r?.volts).toBe(0.5);

    const golf = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await golf.connect();
    expect(await golf.readMode05('01', '01')).toBeNull();
  });
});
