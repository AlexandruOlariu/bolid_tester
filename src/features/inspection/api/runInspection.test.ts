import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import type { SimScenario } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { createReadOnlySession } from '@/shared/obd-core';
import { bytesToString } from '@/shared/lib/bytes';
import { runInspection } from './runInspection';

const GOLF = 'golf-plus-2009-20tdi';

/** A connected simulated session, plus every command sent after connect. */
async function sessionFor(
  scenario: Partial<SimScenario> = {},
): Promise<{ session: DiagnosticSession; sent: string[] }> {
  const mock = new MockTransport(buildScenario(GOLF, scenario));
  const sent: string[] = [];
  const write = mock.write.bind(mock);
  mock.write = async (bytes: Uint8Array) => {
    sent.push(bytesToString(bytes).trim());
    return write(bytes);
  };
  const session = new DiagnosticSession(mock, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  sent.splice(0);
  return { session, sent };
}

describe('runInspection', () => {
  it('runInspection flags recently cleared codes on a fresh Golf', async () => {
    // A Golf whose codes were just cleared: no codes, every supported monitor back to "not ready",
    // and 12 km since the clear. The simulator always reports complete monitors and 1234 km on
    // 0131, so those two reads are overridden on top of the real read-only facade.
    const { session: golfSession } = await sessionFor({
      storedDtcs: [],
      pendingDtcs: [],
      permanentDtcs: [],
    });
    const ro = createReadOnlySession(golfSession);
    const fresh = {
      ...ro,
      readReadiness: async () => {
        const r = await ro.readReadiness();
        return r && { ...r, monitors: r.monitors.map((m) => ({ ...m, complete: !m.supported })) };
      },
      readValue: async (pid: string) => {
        const v = await ro.readValue(pid);
        return pid === '0131'
          ? { pid, name: 'Distance since codes cleared', unit: 'km', value: 12, ts: v?.ts ?? 0 }
          : v;
      },
    };
    const report = await runInspection(fresh, null);
    expect(report.verdict).toBe('caution');
    expect(report.checks.find((c) => c.id === 'recently-cleared')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('12 km since codes were cleared'),
    });
    expect(report.checks.some((c) => c.id === 'readiness')).toBe(false);
  });

  it('fails the simulated Golf on its stored codes, through the read-only facade', async () => {
    const { session, sent } = await sessionFor();
    const report = await runInspection(createReadOnlySession(session), null);
    expect(report.verdict).toBe('fail');
    expect(report.checks.find((c) => c.id === 'stored')).toMatchObject({ status: 'fail' });
    expect(sent).toEqual(expect.arrayContaining(['03', '07', '0A', '0131', '0902']));
    expect(sent.filter((c) => /^(04|14|2E|2F|31|3B|27)/i.test(c))).toEqual([]);
  });

  it('passes a car without codes', async () => {
    const { session } = await sessionFor({ storedDtcs: [], pendingDtcs: [], permanentDtcs: [] });
    const report = await runInspection(createReadOnlySession(session), null);
    expect(report.checks.find((c) => c.id === 'stored')).toMatchObject({ status: 'pass' });
    expect(report.checks.some((c) => c.id === 'pending' || c.id === 'permanent')).toBe(false);
  });

  it('uses the VIN read at connect time instead of reading it again', async () => {
    const { session, sent } = await sessionFor();
    await runInspection(createReadOnlySession(session), 'WVWZZZ1KZ9W903398');
    expect(sent).not.toContain('0902');
  });

  it('notes a VIN the ECU does not report', async () => {
    const { session } = await sessionFor({ vinSupported: false });
    const report = await runInspection(createReadOnlySession(session), null);
    expect(report.checks.find((c) => c.id === 'vin')).toMatchObject({ status: 'info' });
  });
});
