/** Known adapters (plan 29): the community compatibility matrix bundled into the app. The list is
 *  generated from `docs/adapters/reports/*.json` by `scripts/build-adapter-matrix.mjs` into
 *  `knownAdapters.json` (never edit it by hand); this module matches a scanned device or a health
 *  result against it. Pure — no React Native import. See docs/adapters/README.md. */
import knownAdapters from './knownAdapters.json';
import { isPlaceholderDeviceName, type KnownAdapter } from './adapterMatrix';

export type {
  AdapterReportJson,
  AdapterReportGrade,
  AdapterReportLink,
  AdapterReportPlatform,
  KnownAdapter,
} from './adapterMatrix';
export {
  adapterSlug,
  reportFileName,
  validateAdapterReport,
  buildAdapterMatrix,
  isPlaceholderDeviceName,
  reportDeviceName,
  PLACEHOLDER_DEVICE_NAMES,
  WIFI_DEVICE_NAME,
  WEB_BLE_DEVICE_NAME,
  SPP_DEVICE_NAME,
} from './adapterMatrix';

/** The bundled list (empty until the first community report is committed). */
export const KNOWN_ADAPTERS: KnownAdapter[] = knownAdapters as KnownAdapter[];

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** The known adapter for an advertised name: an exact (case-insensitive) name-hint match, then the
 *  firmware (`ATI`) as the tie-break between several, then the one with the most reports. Exact
 *  matching on purpose — generic names like "OBDII" must not borrow another adapter's grade, and
 *  the connect flow's stand-in names ("Wi-Fi ELM327", `PLACEHOLDER_DEVICE_NAMES`) never match. */
export function matchKnownAdapter(
  deviceName: string | null,
  firmware?: string | null,
  list: readonly KnownAdapter[] = KNOWN_ADAPTERS,
): KnownAdapter | null {
  const name = norm(deviceName);
  if (!name || isPlaceholderDeviceName(name)) return null;
  const candidates = list.filter((k) => k.nameHints.includes(name));
  if (candidates.length === 0) return null;
  const fw = norm(firmware);
  const byFirmware = fw ? candidates.filter((k) => norm(k.firmware) === fw) : [];
  const pool = byFirmware.length ? byFirmware : candidates;
  return pool.reduce((best, k) => (k.reports > best.reports ? k : best));
}

/** "3 community reports · typically GOOD · ~28 ms". */
export function communitySummary(k: KnownAdapter): string {
  const parts = [
    `${k.reports} community ${k.reports === 1 ? 'report' : 'reports'}`,
    `typically ${k.typicalGrade.toUpperCase()}`,
  ];
  if (k.medianMs != null) parts.push(`~${Math.round(k.medianMs)} ms`);
  return parts.join(' · ');
}

/** The scan-list chip text: "known good" / "known ok" / "known poor". */
export function knownAdapterChip(k: KnownAdapter): string {
  return `known ${k.typicalGrade}`;
}
