/** Pure helpers deciding what the app-wide poll loop should read each sweep. Kept free of React and
 *  stores so the demand-driven PID math is unit-tested directly. See EngineHost. */

import type { AlertRule } from '@/shared/obd-core';

/** PIDs referenced by the *enabled* alert rules (disabled rules cost no bus traffic). */
export function enabledRulePids(rules: AlertRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (r.enabled === false) continue;
    if (!out.includes(r.pid)) out.push(r.pid);
  }
  return out;
}

export interface PollPidInput {
  /** PID interest registered by mounted screens (liveDataStore), keyed by subscriber id. */
  registrations: Record<string, string[]>;
  /** PIDs needed to evaluate enabled alert rules. */
  alertPids: string[];
  /** The trip's PID set while recording (the effective PID set); empty when not recording. */
  tripPids: string[];
}

/** The union of every source of demand. Empty result + not recording ⇒ the loop idles. Order is
 *  stable: registrations first (screen order), then alert-only PIDs, then trip-only PIDs. */
export function computePollPids(input: PollPidInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (pid: string) => {
    if (!seen.has(pid)) {
      seen.add(pid);
      out.push(pid);
    }
  };
  for (const pids of Object.values(input.registrations)) for (const p of pids) add(p);
  for (const p of input.alertPids) add(p);
  for (const p of input.tripPids) add(p);
  return out;
}
