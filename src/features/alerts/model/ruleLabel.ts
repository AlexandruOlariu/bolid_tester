/** How an alert rule is named on screen and in its OS notification (plan 11). The starter rules
 *  (`defaultRules` in obd-core) carry an English `label`; while it is unchanged it is shown from
 *  `alerts:defaultRule.<id>` in the UI language. A label the user wrote, and a rule without one
 *  (named by its PID), are shown as they are. */
import { defaultRules, type AlertRule } from '@/shared/obd-core';
import { translate } from '@/shared/i18n';
import { formatNumber } from '@/shared/lib/format';

/** Starter rule id → its English label, as `defaultRules` writes it. */
const STARTER_LABELS = new Map(
  defaultRules(['0105', '0142', '010C']).map((r) => [r.id, r.label] as const),
);

export function ruleLabel(rule: Pick<AlertRule, 'id' | 'pid' | 'label'>): string {
  const starter = STARTER_LABELS.get(rule.id);
  if (starter !== undefined && rule.label === starter)
    return translate(`alerts:defaultRule.${rule.id}`, { defaultValue: starter });
  return rule.label ?? rule.pid;
}

/** A threshold or live value in the UI language's number format (`11.8` / `11,8`). */
export function formatAlertValue(value: number): string {
  return formatNumber(value, 2);
}
