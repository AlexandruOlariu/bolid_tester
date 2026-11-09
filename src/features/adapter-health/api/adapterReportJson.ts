/** Structured (JSON, schema v1) form of an adapter health run — the "Share JSON (for the
 *  compatibility matrix)" artifact (plan 29). Pure: the hook supplies the app / link context. The
 *  schema, its validator and the slug live in `@/shared/adapters` because the matrix build script
 *  (`scripts/build-adapter-matrix.mjs`) shares them. Privacy: `vehicle` carries only the profile id
 *  and the protocol — never a VIN, never a location. See docs/adapters/README.md. */
import {
  adapterSlug,
  reportDeviceName,
  reportFileName,
  type AdapterReportJson,
  type AdapterReportLink,
  type AdapterReportPlatform,
} from '@/shared/adapters';
import type { AdapterReportInput } from './adapterReport';

export type { AdapterReportJson };
export { adapterSlug, reportFileName };

export interface AdapterReportJsonContext {
  appVersion: string;
  platform: AdapterReportPlatform;
  os?: string;
  /** The adapter's advertised name (`sessionStore.deviceName`). A connect-flow stand-in such as
   *  "Wi-Fi ELM327" is written as null (`reportDeviceName`). */
  deviceName: string | null;
  link: AdapterReportLink;
  /** Active vehicle profile id. */
  profileId: string;
  /** The negotiated BLE link (`linkStore.link`), when there is one. */
  linkInfo?: { service: string; writeWithoutResponse: boolean; mtu: number } | null;
}

/** The report's `adapter.link` from the latest connect attempt's link kind (`linkStore.kind`, null
 *  for the simulator → `mock`, which the matrix build refuses); Bluetooth LE in a browser is the
 *  Web Bluetooth transport (`web-ble`, plan 28). */
export function reportLinkFor(
  kind: 'ble' | 'wifi' | 'spp' | null,
  platform: AdapterReportPlatform,
): AdapterReportLink {
  if (kind == null) return 'mock';
  return kind === 'ble' && platform === 'web' ? 'web-ble' : kind;
}

/** Build the schema-v1 report from a finished run. */
export function buildAdapterReportJson(
  report: AdapterReportInput,
  ctx: AdapterReportJsonContext,
): AdapterReportJson {
  const adapter: AdapterReportJson['adapter'] = {
    deviceName: reportDeviceName(ctx.deviceName),
    firmware: report.version,
    link: ctx.link,
  };
  if (ctx.linkInfo) {
    adapter.service = ctx.linkInfo.service;
    adapter.writeWithoutResponse = ctx.linkInfo.writeWithoutResponse;
    adapter.mtu = ctx.linkInfo.mtu;
  }
  const app: AdapterReportJson['app'] = { version: ctx.appVersion, platform: ctx.platform };
  if (ctx.os) app.os = ctx.os;
  const { latency } = report.result;
  return {
    schema: 1,
    app,
    adapter,
    vehicle: { profileId: ctx.profileId, protocol: report.protocol },
    measurements: {
      voltage: report.voltage,
      latenciesMs: report.latenciesMs.slice(),
      attempts: report.attempts,
      latency: latency ? { ...latency } : null,
    },
    grade: {
      grade: report.result.grade,
      cloneSuspected: report.result.cloneSuspected,
      notes: report.result.notes.slice(),
    },
    ranAt: new Date(report.ranAt).toISOString(),
  };
}
