/** Pure view model for the DTC detail sheet (plan 05): what the sheet shows for one code, the web
 *  search link and the text the Share action sends. No React / RN imports, so it is unit-tested in
 *  node. See docs/features/fault-codes.md § "Detail sheet". */

import {
  DTC_SYSTEM_LABEL,
  lookupDtc,
  vagCodeForDtc,
  type DtcInfo,
  type DtcMake,
  type DtcSeverity,
} from '@/shared/obd-core/obd/dtc';

export const SEVERITY_META: Record<DtcSeverity, { label: string; color: string; hint: string }> = {
  high: {
    label: 'High',
    color: '#f85149',
    hint: 'Can damage the engine or catalyst, or affect safety. Check it before driving far.',
  },
  moderate: {
    label: 'Moderate',
    color: '#d29922',
    hint: 'Needs attention soon (emissions, a control module or a lost connection between modules).',
  },
  info: {
    label: 'Info',
    color: '#388bfd',
    hint: 'A recorded fault with a known meaning. Check it, but it is rarely urgent on its own.',
  },
  unknown: {
    label: 'Unknown',
    color: '#8B949E',
    hint: 'No local description for this code. Use the web search or the AI explanation.',
  },
};

export const DTC_DETAIL_FOOTER =
  'Descriptions follow SAE J2012. Causes and fixes vary by car; use the guide and freeze frame ' +
  'before replacing parts.';

export interface DtcDetail {
  info: DtcInfo;
  /** The description to show: the one the read produced (make-aware), else the database's. */
  description: string;
  /** VAG 5-digit number (P codes; shown for VAG and generic profiles, hidden for other makes). */
  vagCode: string;
  /** "Powertrain · Ignition system / misfire". */
  systemLine: string;
}

export function buildDtcDetail(
  code: string,
  description: string | undefined,
  make: DtcMake | undefined,
): DtcDetail {
  const info = lookupDtc(code, make ?? 'generic');
  return {
    info,
    description: description?.trim() || info.description,
    vagCode: !make || make === 'vag' || make === 'generic' ? vagCodeForDtc(info.code) : '',
    systemLine: `${DTC_SYSTEM_LABEL[info.system]} · ${info.subsystem}`,
  };
}

/** Web search deep link: code + "OBD2" + the car name (when one is selected). */
export function dtcWebSearchUrl(code: string, vehicleName?: string): string {
  const q = [code, 'OBD2', vehicleName ?? ''].join(' ').trim();
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

/** Plain-text summary the Share action sends. */
export function dtcShareMessage(d: DtcDetail, vehicleName?: string): string {
  const lines = [
    d.vagCode ? `${d.info.code} (VAG ${d.vagCode})` : d.info.code,
    d.description,
    d.systemLine,
    `Severity: ${SEVERITY_META[d.info.severity].label}${d.info.manufacturerSpecific ? ' · manufacturer-specific' : ''}`,
  ];
  if (vehicleName) lines.push(`Vehicle: ${vehicleName}`);
  return lines.join('\n');
}
