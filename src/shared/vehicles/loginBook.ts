/** The per-car **code book** (plan 22): resolve, add and remove KWP module login codes. Pure. The
 *  user's own codes (a garage car's `loginCodes`, or a registry car's shadow entry in the login
 *  book store) win over codes a profile documents from the owner's VCDS logs. No codes ship with
 *  the app. See docs/features/adaptations.md → "Code book". */

import type { LoginCodeEntry, VehicleProfile } from './types';

/** Anything that carries a code book: a `UserVehicle`, or the login book's shadow entry. */
export interface HasLoginCodes {
  loginCodes?: LoginCodeEntry[];
}

const norm = (address: string) => address.trim().toUpperCase();

/** The login code for module `address`: the user's entry first, then the profile's documented
 *  one; null when neither has it. */
export function loginCodeFor(
  profile: Pick<VehicleProfile, 'loginCodes'>,
  user: HasLoginCodes | null | undefined,
  address: string,
): LoginCodeEntry | null {
  const a = norm(address);
  const pick = (list?: LoginCodeEntry[]) => list?.find((e) => norm(e.address) === a) ?? null;
  return pick(user?.loginCodes) ?? pick(profile.loginCodes);
}

/** `list` with `entry` added, replacing any entry for the same module address (one code per
 *  module). */
export function upsertLoginCode(
  list: LoginCodeEntry[] | undefined,
  entry: LoginCodeEntry,
): LoginCodeEntry[] {
  const a = norm(entry.address);
  return [...(list ?? []).filter((e) => norm(e.address) !== a), entry];
}

/** `list` without the entry for module `address`. */
export function removeLoginCode(
  list: LoginCodeEntry[] | undefined,
  address: string,
): LoginCodeEntry[] {
  const a = norm(address);
  return (list ?? []).filter((e) => norm(e.address) !== a);
}

const SOURCES: LoginCodeEntry['source'][] = ['owner-vcds-log', 'user-entered', 'documented'];

/** Keep only well-formed entries from a persisted / imported list (a hand-edited file must not
 *  put a non-number code on the wire). Undefined when nothing usable remains. */
export function sanitizeLoginCodes(raw: unknown): LoginCodeEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LoginCodeEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Partial<LoginCodeEntry>;
    if (
      typeof e.address !== 'string' ||
      e.address.trim() === '' ||
      typeof e.code !== 'number' ||
      !Number.isInteger(e.code) ||
      e.code < 0 ||
      e.code > 0xffff ||
      (e.wsc !== undefined &&
        (typeof e.wsc !== 'number' || !Number.isInteger(e.wsc) || e.wsc < 0 || e.wsc > 99999))
    ) {
      continue;
    }
    out.push({
      address: e.address,
      code: e.code,
      ...(e.wsc !== undefined ? { wsc: e.wsc } : {}),
      purpose: typeof e.purpose === 'string' ? e.purpose : '',
      source: SOURCES.includes(e.source as LoginCodeEntry['source'])
        ? (e.source as LoginCodeEntry['source'])
        : 'user-entered',
    });
  }
  return out.length ? out : undefined;
}

/** A login code as the UI lists it without revealing it. */
export const MASKED_LOGIN_CODE = '•••••';
