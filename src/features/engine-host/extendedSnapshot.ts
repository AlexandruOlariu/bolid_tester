/** Pure decode of one extended (Mode 22) poll sweep into live values keyed `22:<DID>`, so they sit
 *  in `liveDataStore.values` next to the Mode 01 PIDs. See docs/features/engine-host.md. */

import { extendedKey, type LiveValue } from '@/shared/obd-core';
import type { ExtendedPid } from '@/shared/vehicles';

/** For each DID with a profile definition and non-null bytes → a `LiveValue` keyed
 *  `extendedKey(did)`, decoded by the definition. DIDs without a definition, with null bytes or
 *  whose decoder throws / returns a non-finite number are omitted — the previous value simply ages
 *  out, matching how a Mode 01 PID that stops answering behaves. */
export function decodeExtendedSnapshot(
  raw: Record<string, number[] | null>,
  defs: readonly ExtendedPid[],
  ts: number,
): Record<string, LiveValue> {
  const out: Record<string, LiveValue> = {};
  for (const [did, bytes] of Object.entries(raw)) {
    if (!bytes) continue;
    const def = defs.find((d) => d.did.toUpperCase() === did.toUpperCase());
    if (!def) continue;
    let value: number;
    try {
      value = def.decode(bytes);
    } catch {
      continue;
    }
    if (!Number.isFinite(value)) continue;
    const key = extendedKey(did);
    out[key] = { pid: key, name: def.name, unit: def.unit, value, ts };
  }
  return out;
}
