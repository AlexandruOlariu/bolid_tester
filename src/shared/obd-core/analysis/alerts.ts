/** Pure threshold-alert engine. Evaluates user rules against a live snapshot with edge detection
 *  and hysteresis so alerts don't flap. UI-agnostic. See docs/features/alerts.md. */

export type AlertSeverity = 'info' | 'warn' | 'critical';

/** Comparison operators. `gt`/`lt` use `value`; `outside`/`inside` use `[value, value2]`. */
export type AlertOp = 'gt' | 'lt' | 'outside' | 'inside';

export interface AlertRule {
  id: string;
  pid: string;
  op: AlertOp;
  value: number;
  value2?: number;
  /** Clear margin applied past the threshold before an active alert clears. */
  hysteresis?: number;
  severity: AlertSeverity;
  enabled?: boolean;
  label?: string;
}

export interface ActiveAlert {
  ruleId: string;
  pid: string;
  severity: AlertSeverity;
  value: number;
  since: number;
  rule: AlertRule;
}

/** A minimal snapshot shape: PID → numeric value (matches the live-data store). */
export type Snapshot = Record<string, { value: number } | number | null | undefined>;

export interface AlertEvalResult {
  active: ActiveAlert[];
  fired: ActiveAlert[];
  cleared: ActiveAlert[];
}

function readValue(snapshot: Snapshot, pid: string): number | null {
  const v = snapshot[pid];
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : v.value;
}

/** Is the raw condition (without hysteresis) tripped at this value? */
function tripped(rule: AlertRule, v: number): boolean {
  switch (rule.op) {
    case 'gt':
      return v > rule.value;
    case 'lt':
      return v < rule.value;
    case 'outside':
      return v < rule.value || v > (rule.value2 ?? rule.value);
    case 'inside':
      return v >= rule.value && v <= (rule.value2 ?? rule.value);
  }
}

/** Should an already-active alert remain active, given hysteresis? It stays until the value passes
 *  the threshold by `hysteresis`. */
function stillTripped(rule: AlertRule, v: number): boolean {
  const h = rule.hysteresis ?? 0;
  if (h <= 0) return tripped(rule, v);
  switch (rule.op) {
    case 'gt':
      return v > rule.value - h;
    case 'lt':
      return v < rule.value + h;
    case 'outside':
      return v < rule.value + h || v > (rule.value2 ?? rule.value) - h;
    case 'inside':
      return v >= rule.value - h && v <= (rule.value2 ?? rule.value) + h;
  }
}

/** The engine holds the set of currently-active rule ids between snapshots. */
export class AlertEngine {
  private active = new Map<string, ActiveAlert>();

  reset(): void {
    this.active.clear();
  }

  get current(): ActiveAlert[] {
    return [...this.active.values()];
  }

  /** Evaluate one snapshot, returning the new active set plus what fired / cleared this tick. */
  evaluate(rules: AlertRule[], snapshot: Snapshot, now: number = Date.now()): AlertEvalResult {
    const fired: ActiveAlert[] = [];
    const cleared: ActiveAlert[] = [];
    const enabled = new Set(rules.filter((r) => r.enabled !== false).map((r) => r.id));

    // Clear alerts whose rule was deleted/disabled.
    for (const [id, a] of [...this.active]) {
      if (!enabled.has(id)) {
        this.active.delete(id);
        cleared.push(a);
      }
    }

    for (const rule of rules) {
      if (rule.enabled === false) continue;
      const v = readValue(snapshot, rule.pid);
      if (v === null) continue;
      const wasActive = this.active.get(rule.id);
      const shouldBeActive = wasActive ? stillTripped(rule, v) : tripped(rule, v);

      if (shouldBeActive && !wasActive) {
        const a: ActiveAlert = {
          ruleId: rule.id,
          pid: rule.pid,
          severity: rule.severity,
          value: v,
          since: now,
          rule,
        };
        this.active.set(rule.id, a);
        fired.push(a);
      } else if (shouldBeActive && wasActive) {
        wasActive.value = v; // refresh
      } else if (!shouldBeActive && wasActive) {
        this.active.delete(rule.id);
        cleared.push(wasActive);
      }
    }

    return { active: this.current, fired, cleared };
  }
}

/** Sensible starter rules for a profile's effective PID set (the UI can edit/delete these). */
export function defaultRules(effectivePids: string[]): AlertRule[] {
  const rules: AlertRule[] = [];
  if (effectivePids.includes('0105'))
    rules.push({ id: 'coolant-hot', pid: '0105', op: 'gt', value: 110, hysteresis: 5, severity: 'critical', label: 'Coolant overheating' });
  if (effectivePids.includes('0142'))
    rules.push({ id: 'low-voltage', pid: '0142', op: 'lt', value: 11.8, hysteresis: 0.4, severity: 'warn', label: 'Low battery voltage' });
  if (effectivePids.includes('010C'))
    rules.push({ id: 'over-rev', pid: '010C', op: 'gt', value: 5000, hysteresis: 200, severity: 'warn', label: 'High RPM' });
  return rules;
}
