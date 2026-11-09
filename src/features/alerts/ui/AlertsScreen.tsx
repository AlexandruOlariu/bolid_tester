import React from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, HIT_SLOP, AccessibleSwitch } from '@/shared/ui';
import { useAlerts } from '../hooks/useAlerts';
import { useAlertsStore } from '../model/alertsStore';

const OP_LABEL: Record<string, string> = { gt: '>', lt: '<', outside: 'outside', inside: 'inside' };

export function AlertsScreen() {
  const { active } = useAlerts();
  const rules = useAlertsStore((s) => s.rules);
  const toggleRule = useAlertsStore((s) => s.toggleRule);
  const removeRule = useAlertsStore((s) => s.removeRule);

  return (
    <Screen title="Alerts" subtitle="Threshold warnings on live parameters">
      {active.length > 0 ? (
        <YStack gap="$1" backgroundColor="$red4" padding="$3" borderRadius="$4">
          <H4 color="$red11">Active</H4>
          {active.map((a) => (
            <Paragraph key={a.ruleId} color="$red11">
              {a.rule.label ?? a.pid}: {a.value}
            </Paragraph>
          ))}
        </YStack>
      ) : null}

      <YStack gap="$2">
        <H4>Rules</H4>
        {rules.length === 0 ? <Paragraph theme="alt2">No rules yet.</Paragraph> : null}
        {rules.map((r) => (
          <XStack key={r.id} justifyContent="space-between" alignItems="center" gap="$2">
            <Paragraph flex={1} opacity={r.enabled === false ? 0.4 : 1}>
              {r.label ?? r.pid} ({r.pid} {OP_LABEL[r.op]} {r.value}) · {r.severity}
            </Paragraph>
            <AccessibleSwitch
              checked={r.enabled !== false}
              onCheckedChange={() => toggleRule(r.id)}
              accessibilityLabel={`Alert ${r.label ?? r.pid}`}
            />
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              theme="red"
              onPress={() => removeRule(r.id)}
              accessibilityLabel={`Delete alert ${r.label ?? r.pid}`}
            >
              Delete
            </Button>
          </XStack>
        ))}
      </YStack>
    </Screen>
  );
}
