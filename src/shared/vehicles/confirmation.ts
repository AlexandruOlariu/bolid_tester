/** Verification state of a per-car profile item (plan 25): standard OBD2, confirmed on the real car
 *  (with evidence), or illustrative / not yet confirmed. Pure — the shared `VerificationBadge`
 *  renders it, the vehicle-docs-sync test enforces the evidence rule through
 *  `confirmationProblems`. See docs/vehicles/README.md → "Confirmation". */

import type { Confirmation } from '../obd-core/confirmation';
import type { VehicleProfile } from './types';

export type VerificationState = 'standard' | 'confirmed' | 'unverified';

/** Anything that can carry the flag pair: every profile array item, a coding preset, a login code. */
export interface VerifiableItem {
  experimental?: boolean;
  confirmed?: Confirmation;
}

/** `standard` when the item is explicitly not experimental (standard OBD2 data), `confirmed` when it
 *  carries evidence, else `unverified` (illustrative, the default for per-car data). */
export function verificationState(item: VerifiableItem): VerificationState {
  if (item.experimental === false) return 'standard';
  if (item.confirmed) return 'confirmed';
  return 'unverified';
}

const SOURCE_TEXT: Record<Confirmation['source'], string> = {
  'sniffer-capture': 'sniffer capture',
  'on-car': 'on the car',
  'vcds-log': 'VCDS log',
};

/** One-line badge text: 'Standard OBD2' | 'Confirmed 2026-11-20 (sniffer capture)' |
 *  'Illustrative — not yet confirmed on this car'. */
export function verificationText(item: VerifiableItem): string {
  const state = verificationState(item);
  if (state === 'standard') return 'Standard OBD2';
  if (state === 'confirmed' && item.confirmed) {
    return `Confirmed ${item.confirmed.on} (${SOURCE_TEXT[item.confirmed.source] ?? item.confirmed.source})`;
  }
  return 'Illustrative — not yet confirmed on this car';
}

/** True when the list is non-empty and every item is confirmed (the DPF subtitle's "All DIDs
 *  confirmed"). A standard item counts as confirmed. */
export function allConfirmed(items: VerifiableItem[]): boolean {
  return items.length > 0 && items.every((i) => verificationState(i) !== 'unverified');
}

/** Every `confirmed` block in a profile, labelled with where it sits (for test messages). */
export function profileConfirmations(
  profile: VehicleProfile,
): { where: string; confirmed: Confirmation }[] {
  const out: { where: string; confirmed: Confirmation }[] = [];
  const add = (where: string, item: { confirmed?: Confirmation } | undefined) => {
    if (item?.confirmed) out.push({ where, confirmed: item.confirmed });
  };
  profile.extendedPids?.forEach((p) => add(`extendedPids ${p.did}`, p));
  profile.modules?.forEach((m) => add(`modules ${m.address} (${m.transport})`, m));
  profile.routines?.forEach((r) => add(`routines ${r.id}`, r));
  profile.adaptations?.forEach((a) => add(`adaptations ${a.did}`, a));
  profile.codingModules?.forEach((c) => add(`codingModules ${c.reqHeader}`, c));
  profile.codingPresets?.forEach((c) => add(`codingPresets ${c.id}`, c));
  profile.moduleSensors?.forEach((s) => add(`moduleSensors ${s.reqHeader} ${s.did}`, s));
  profile.loginCodes?.forEach((l) => add(`loginCodes ${l.address}`, l));
  add('serviceReset', profile.serviceReset);
  return out;
}

/** Where evidence may live (repo-relative, forward slashes). */
export const EVIDENCE_DIRS = ['src/shared/obd-core/transport/fixtures/', 'docs/captures/'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The evidence rule: every `confirmed.on` is a YYYY-MM-DD date and every `fixture` is a
 *  repo-relative path under one of `EVIDENCE_DIRS` that `exists` (injected so it stays pure). One
 *  message per broken entry; [] when the profile is clean. */
export function confirmationProblems(
  profile: VehicleProfile,
  exists: (repoRelativePath: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const { where, confirmed } of profileConfirmations(profile)) {
    if (!ISO_DATE.test(confirmed.on)) {
      problems.push(`${profile.id} ${where}: confirmed.on "${confirmed.on}" is not YYYY-MM-DD`);
    }
    if (confirmed.fixture === undefined) continue;
    const path = confirmed.fixture.replace(/\\/g, '/');
    if (!EVIDENCE_DIRS.some((d) => path.startsWith(d)) || path.includes('..')) {
      problems.push(
        `${profile.id} ${where}: fixture ${confirmed.fixture} is not under ${EVIDENCE_DIRS.join(' or ')}`,
      );
    } else if (!exists(path)) {
      problems.push(`${profile.id} ${where}: fixture ${confirmed.fixture} does not exist`);
    }
  }
  return problems;
}
