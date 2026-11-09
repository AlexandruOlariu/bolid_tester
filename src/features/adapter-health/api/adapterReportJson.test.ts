import { validateAdapterReport } from '@/shared/adapters';
import { Elm327Client, MockTransport, buildScenario } from '@/shared/obd-core';
import { gradeAdapter } from './gradeAdapter';
import type { AdapterReportInput } from './adapterReport';
import {
  adapterSlug,
  buildAdapterReportJson,
  reportFileName,
  reportLinkFor,
} from './adapterReportJson';
import { runHealthCheck } from './runHealthCheck';

const CAN = 'ISO 15765-4 CAN (11-bit, 500 kbps)';
const RAN_AT = Date.UTC(2026, 10, 9, 8, 30, 0);

function run(over: Partial<AdapterReportInput> = {}): AdapterReportInput {
  const base = { version: 'ELM327 v2.2', voltage: 12.3, protocol: CAN, latenciesMs: [3, 4, 4] };
  const merged = { ...base, ...over };
  return {
    ...merged,
    attempts: 3,
    result: gradeAdapter(merged),
    ranAt: RAN_AT,
    ...over,
  };
}

const CTX = {
  appVersion: '0.1.0',
  platform: 'android' as const,
  os: '34',
  deviceName: 'IOS-Vlink',
  link: 'ble' as const,
  profileId: 'golf-plus-2009-20tdi',
};

describe('buildAdapterReportJson', () => {
  it('produces a schema-v1 report that validates', () => {
    const json = buildAdapterReportJson(run(), {
      ...CTX,
      linkInfo: { service: 'fff0', writeWithoutResponse: true, mtu: 185 },
    });
    expect(json).toEqual({
      schema: 1,
      app: { version: '0.1.0', platform: 'android', os: '34' },
      adapter: {
        deviceName: 'IOS-Vlink',
        firmware: 'ELM327 v2.2',
        link: 'ble',
        service: 'fff0',
        writeWithoutResponse: true,
        mtu: 185,
      },
      vehicle: { profileId: 'golf-plus-2009-20tdi', protocol: CAN },
      measurements: {
        voltage: 12.3,
        latenciesMs: [3, 4, 4],
        attempts: 3,
        latency: { min: 3, median: 4, max: 4, count: 3 },
      },
      grade: { grade: 'good', cloneSuspected: false, notes: expect.any(Array) },
      ranAt: '2026-11-09T08:30:00.000Z',
    });
    expect(validateAdapterReport(json)).toEqual([]);
    expect(reportFileName(json)).toBe('ios-vlink__elm327-v2-2__2026-11-09.json');
  });

  it('writes an ISO date and omits the BLE link details when there is no link', () => {
    const json = buildAdapterReportJson(run(), { ...CTX, os: undefined, linkInfo: null });
    expect(json.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(json.ranAt).getTime()).toBe(RAN_AT);
    expect(Object.keys(json.adapter).sort()).toEqual(['deviceName', 'firmware', 'link']);
    expect('os' in json.app).toBe(false);
  });

  it('carries no VIN or location: vehicle is only the profile id and the protocol', () => {
    const json = buildAdapterReportJson(run(), CTX);
    expect(Object.keys(json.vehicle).sort()).toEqual(['profileId', 'protocol']);
    expect(Object.keys(json).sort()).toEqual(
      ['adapter', 'app', 'grade', 'measurements', 'ranAt', 'schema', 'vehicle'].sort(),
    );
    expect(JSON.stringify(json)).not.toMatch(/vin|latitude|longitude|location/i);
  });

  it('writes a stand-in connection name (Wi-Fi, unnamed Web BLE / SPP) as null', () => {
    for (const deviceName of [
      'Wi-Fi ELM327',
      'Bluetooth LE adapter',
      'Classic Bluetooth adapter',
    ]) {
      const json = buildAdapterReportJson(run(), { ...CTX, deviceName, link: 'wifi' });
      expect(json.adapter.deviceName).toBeNull();
      expect(validateAdapterReport(json)).toEqual([]);
      expect(reportFileName(json)).toBe('unknown__elm327-v2-2__2026-11-09.json');
    }
  });

  it('keeps a non-answering run (latency null) valid', () => {
    const json = buildAdapterReportJson(run({ latenciesMs: [], version: '' }), CTX);
    expect(json.measurements.latency).toBeNull();
    expect(json.grade.grade).toBe('poor');
    expect(validateAdapterReport(json)).toEqual([]);
  });
});

describe('adapterSlug (re-exported for the share file name)', () => {
  it('normalises name and firmware; a null name is "unknown"', () => {
    expect(adapterSlug('IOS-Vlink', 'ELM327 v2.2')).toBe('ios-vlink__elm327-v2-2');
    expect(adapterSlug(null, 'ELM327 v2.2')).toBe('unknown__elm327-v2-2');
  });
});

describe('reportLinkFor', () => {
  it('maps the attempt link kind; the simulator is mock; BLE in a browser is web-ble', () => {
    expect(reportLinkFor(null, 'android')).toBe('mock');
    expect(reportLinkFor('ble', 'android')).toBe('ble');
    expect(reportLinkFor('ble', 'ios')).toBe('ble');
    expect(reportLinkFor('ble', 'web')).toBe('web-ble');
    expect(reportLinkFor('wifi', 'android')).toBe('wifi');
    expect(reportLinkFor('spp', 'android')).toBe('spp');
  });
});

describe('simulator end to end', () => {
  it('runs the health check on the simulator and shares a valid mock report the matrix refuses', async () => {
    const transport = new MockTransport(buildScenario('golf-plus-2009-20tdi', {}));
    const client = new Elm327Client(transport, { commandTimeoutMs: 1000 });
    await transport.connect();
    await client.init();
    const phases: string[] = [];
    // A stepping clock makes the latencies deterministic (the simulator answers at once; the
    // wall-clock latency of the run is covered by the hook on a device).
    let t = RAN_AT;
    const report = await runHealthCheck(client, {
      onPhase: (p) => phases.push(p),
      now: () => (t += 3),
    });
    await transport.disconnect();

    expect(report.version).toBe('ELM327 v2.2');
    expect(report.voltage).toBeCloseTo(12.3, 1);
    expect(report.protocol).toMatch(/CAN/);
    expect(report.attempts).toBe(10);
    expect(report.latenciesMs).toHaveLength(10);
    expect(report.result.latency).toEqual({ min: 3, median: 3, max: 3, count: 10 });
    expect(report.result.grade).toBe('good');
    expect(phases[0]).toBe('Reading firmware (ATI)…');
    expect(phases).toContain('Timing 0100 (10/10)…');

    const json = buildAdapterReportJson(report, {
      ...CTX,
      deviceName: 'Simulator · golf-plus-2009-20tdi',
      link: reportLinkFor(null, 'android'),
    });
    expect(json.adapter.link).toBe('mock');
    expect(validateAdapterReport(json, { allowMock: true })).toEqual([]);
    expect(validateAdapterReport(json).join(' ')).toMatch(/simulator reports/);
  });

  it('stops the burst early and counts failed commands as attempts', async () => {
    let calls = 0;
    const client = {
      version: async () => 'ELM327 v1.5',
      voltage: async () => {
        throw new Error('no ATRV');
      },
      protocolNumber: async () => 'ISO_15765_4_CAN_11_500' as const,
      command: async () => {
        calls++;
        if (calls === 2) throw new Error('NO DATA');
        return {};
      },
    };
    const report = await runHealthCheck(client, { burst: 5, shouldStop: () => calls >= 3 });
    expect(report.voltage).toBeNull();
    expect(report.attempts).toBe(3);
    expect(report.latenciesMs).toHaveLength(2);
    expect(report.result.cloneSuspected).toBe(true);
  });
});
