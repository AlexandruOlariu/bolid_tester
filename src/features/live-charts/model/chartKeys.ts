/** Which live keys a chart panel can plot, and their labels. Pure — unit-tested. A key is a Mode 01
 *  PID or an extended `22:<DID>` key (see `obd-core/obd/liveKeys.ts`). */
import { extendedKey, labelForLiveKey, type LiveKeyDef } from '@/shared/obd-core';

export interface ChartKeyOption {
  key: string;
  label: string;
  extended: boolean;
}

/** The panel picker's options: the effective Mode 01 PIDs, then — only on CAN with a profile that
 *  declares DIDs — every extended key, labelled `name (unit) · DID`. */
export function chartKeyOptions(
  effectivePids: readonly string[],
  extendedDefs: readonly LiveKeyDef[],
  can: boolean,
): ChartKeyOption[] {
  const out: ChartKeyOption[] = effectivePids.map((key) => ({
    key,
    label: labelForLiveKey(key),
    extended: false,
  }));
  if (can) {
    for (const d of extendedDefs) {
      const key = extendedKey(d.did);
      out.push({ key, label: labelForLiveKey(key, extendedDefs), extended: true });
    }
  }
  return out;
}

/** Labels for a panel's keys (header, stats lines, CSV label column). */
export function panelLabels(
  keys: readonly string[],
  extendedDefs: readonly LiveKeyDef[],
): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, labelForLiveKey(k, extendedDefs)]));
}
