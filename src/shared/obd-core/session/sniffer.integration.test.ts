/** Integration: ATMA sniffer against the simulator — start, stream, stop, and confirm normal
 *  commands still work afterwards (queue released, headers restored); a capture taken during the
 *  run formats into a CSV with one row per frame (plan 03). */
import { DiagnosticSession } from './DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { CanFrameAggregator, formatCaptureCsv } from '../obd/canMonitor';
import { CaptureBuffer } from '../obd/captureBuffer';

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

  it('the Golf stream carries ~30 frames across 4 ids (tester session + TP2.0 setup)', () => {
    const frames = buildScenario('golf-plus-2009-20tdi').monitorFrames ?? [];
    expect(frames.length).toBeGreaterThanOrEqual(30);
    const ids = new Set(frames.map((f) => f.split(' ')[0]));
    expect([...ids].sort()).toEqual(['200', '201', '7E0', '7E8']);
  });

  it('start -> 20 lines -> stop: the CSV has the header lines and 20 data rows', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    const info = await session.connect();

    const startedAt = Date.now();
    const buffer = new CaptureBuffer();
    let stopping: Promise<void> | null = null;
    let reached!: () => void;
    const twenty = new Promise<void>((r) => (reached = r));
    await session.startSniffer((line) => {
      if (stopping) return;
      buffer.push(line, Date.now());
      if (buffer.size === 20) {
        // Any byte interrupts ATMA synchronously in the simulator, so the stream ends at 20.
        stopping = session.stopSniffer();
        reached();
      }
    });
    await twenty;
    await stopping;
    expect(session.sniffing).toBe(false);

    const csv = formatCaptureCsv(
      {
        vehicleId: 'golf-plus-2009-20tdi',
        protocol: info.protocol,
        adapter: info.version,
        startedAt,
        note: 'sim run',
        dropped: buffer.dropped,
      },
      buffer.lines(),
    );
    const rows = csv.trimEnd().split('\n');
    expect(rows).toContain('# vehicle: golf-plus-2009-20tdi');
    expect(rows).toContain('# note: sim run');
    expect(rows).toContain(`# protocol: ${info.protocol}`);
    const col = rows.indexOf('t_ms,id,dlc,bytes');
    const data = rows.slice(col + 1).filter((r) => !r.startsWith('#'));
    expect(data).toHaveLength(20);
    expect(data[0]).toMatch(/^\d+,200,7,01 C0 00 10 00 03 01$/);
    // t_ms is relative and non-decreasing.
    const ts = data.map((r) => Number(r.split(',')[0]));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(ts[ts.length - 1]).toBeLessThan(60_000);
  });
});
