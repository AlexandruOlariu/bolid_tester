/** Live-value keys. A key in `liveDataStore.values` / a poll registration is either a Mode 01 PID
 *  (`'010C'`) or an extended (Mode 22) DID key `'22:<DID>'` (`'22:1701'`). Both live in the same
 *  map, so every consumer that treats keys as opaque strings (charts, CSV, alerts) works unchanged.
 *  See docs/features/engine-host.md → "Split sweep". Pure, no I/O. */

import { PID_REGISTRY } from './pids';

const EXT_PREFIX = '22:';

/** The live-value key of an extended DID, e.g. `extendedKey('1701')` → `'22:1701'`. */
export const extendedKey = (did: string): string => `${EXT_PREFIX}${did.toUpperCase()}`;

/** True for an extended (Mode 22) key. */
export const isExtendedKey = (key: string): boolean => key.startsWith(EXT_PREFIX);

/** The DID of an extended key (`'22:1701'` → `'1701'`). */
export const didOfKey = (key: string): string => key.slice(EXT_PREFIX.length);

/** Split a poll key list into Mode 01 PIDs and extended DIDs (order preserved, de-duplicated). */
export function splitPollKeys(keys: string[]): { pids: string[]; dids: string[] } {
  const pids: string[] = [];
  const dids: string[] = [];
  for (const key of keys) {
    if (isExtendedKey(key)) {
      const did = didOfKey(key).toUpperCase();
      if (did && !dids.includes(did)) dids.push(did);
    } else if (!pids.includes(key)) {
      pids.push(key);
    }
  }
  return { pids, dids };
}

/** The minimal shape of an extended-DID definition a label needs (a profile's `ExtendedPid`). */
export interface LiveKeyDef {
  did: string;
  name: string;
  unit: string;
}

const withUnit = (name: string, unit: string) => (unit ? `${name} (${unit})` : name);

/** A human label for a live key: `Engine RPM (rpm)` for a Mode 01 PID (from the PID registry),
 *  `DPF soot mass (calc.) (g) · 1701` for an extended key the profile defines, `DID 1701` for one
 *  it does not, and the raw key for an unknown Mode 01 PID. */
export function labelForLiveKey(key: string, extendedDefs: readonly LiveKeyDef[] = []): string {
  if (isExtendedKey(key)) {
    const did = didOfKey(key).toUpperCase();
    const def = extendedDefs.find((d) => d.did.toUpperCase() === did);
    return def ? `${withUnit(def.name, def.unit)} · ${did}` : `DID ${did}`;
  }
  const d = PID_REGISTRY[key];
  return d ? withUnit(d.name, d.unit) : key;
}
