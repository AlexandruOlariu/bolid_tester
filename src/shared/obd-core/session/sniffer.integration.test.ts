/** Integration: ATMA sniffer against the simulator — start, stream, stop, and confirm normal
 *  commands still work afterwards (queue released, headers restored). */
import { DiagnosticSession } from './DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { CanFrameAggregator } from '../obd/canMonitor';

describe('CAN sniffer against the simulator', () => {
  it('streams frames during ATMA and resumes commands after stop', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await session.connect();

    const agg = new CanFrameAggregator();
    let lines = 0;
    await session.startSniffer((line) => {
      lines += 1;
      agg.add(line);
    });
    expect(session.sniffing).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    await session.stopSniffer();
    expect(session.sniffing).toBe(false);

    expect(lines).toBeGreaterThan(3);
    const snap = agg.snapshot();
    expect(snap.length).toBeGreaterThanOrEqual(3);
    expect(snap.some((s) => s.id === '7E8')).toBe(true);

    // Channel is usable again.
    const v = await session.readValue('010C');
    expect(v?.value).toBeCloseTo(820, 0);
  });
});
