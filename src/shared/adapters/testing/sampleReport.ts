/** A valid schema-v1 adapter report for the matrix tests; override any part. */
import type { AdapterReportJson } from '../adapterMatrix';

export function sampleReport(
  over: {
    deviceName?: string | null;
    firmware?: string;
    link?: AdapterReportJson['adapter']['link'];
    platform?: AdapterReportJson['app']['platform'];
    protocol?: string;
    grade?: AdapterReportJson['grade']['grade'];
    cloneSuspected?: boolean;
    median?: number | null;
    ranAt?: string;
    notes?: string[];
  } = {},
): AdapterReportJson {
  const median = over.median === undefined ? 25 : over.median;
  return {
    schema: 1,
    app: { version: '0.1.0', platform: over.platform ?? 'android', os: '34' },
    adapter: {
      deviceName: over.deviceName === undefined ? 'IOS-Vlink' : over.deviceName,
      firmware: over.firmware ?? 'ELM327 v2.2',
      link: over.link ?? 'ble',
      service: '0000fff0-0000-1000-8000-00805f9b34fb',
      writeWithoutResponse: true,
      mtu: 185,
    },
    vehicle: {
      profileId: 'golf-plus-2009-20tdi',
      protocol: over.protocol ?? 'ISO 15765-4 CAN (11-bit, 500 kbps)',
    },
    measurements: {
      voltage: 12.4,
      latenciesMs: median == null ? [] : [median - 5, median, median + 5],
      attempts: 10,
      latency: median == null ? null : { min: median - 5, median, max: median + 5, count: 3 },
    },
    grade: {
      grade: over.grade ?? 'good',
      cloneSuspected: over.cloneSuspected ?? false,
      notes: over.notes ?? [`Median command latency ${median} ms (CAN) — snappy.`],
    },
    ranAt: over.ranAt ?? '2026-11-01T10:00:00.000Z',
  };
}
