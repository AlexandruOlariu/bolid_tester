import React from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, HIT_SLOP, AccessibleSwitch } from '@/shared/ui';
import { useAlerts } from '../hooks/useAlerts';
import { useAlertsStore } from '../model/alertsStore';
import { formatAlertValue, ruleLabel } from '../model/ruleLabel';
import { useTranslation } from '@/shared/i18n';

export function AlertsScreen() {
  const { t } = useTranslation('alerts');
  const opLabel = (op: string) => (op === 'gt' ? '>' : op === 'lt' ? '<' : t(`op.${op}`));
  const { active } = useAlerts();
  const rules = useAlertsStore((s) => s.rules);
  const toggleRule = useAlertsStore((s) => s.toggleRule);
  const removeRule = useAlertsStore((s) => s.removeRule);

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      {active.length > 0 ? (
        <YStack gap="$1" backgroundColor="$red4" padding="$3" borderRadius="$4">
          <H4 color="$red11">{t('active')}</H4>
          {active.map((a) => (
            <Paragraph key={a.ruleId} color="$red11">
              {ruleLabel(a.rule)}: {formatAlertValue(a.value)}
            </Paragraph>
          ))}
        </YStack>
      ) : null}

      <YStack gap="$2">
        <H4>{t('rules')}</H4>
        {rules.length === 0 ? <Paragraph theme="alt2">{t('noRules')}</Paragraph> : null}
        {rules.map((r) => (
          <XStack key={r.id} justifyContent="space-between" alignItems="center" gap="$2">
            <Paragraph flex={1} opacity={r.enabled === false ? 0.4 : 1}>
              {ruleLabel(r)} ({r.pid} {opLabel(r.op)} {formatAlertValue(r.value)}) ·{' '}
              {t(`severity.${r.severity}`, { defaultValue: r.severity })}
            </Paragraph>
            <AccessibleSwitch
              checked={r.enabled !== false}
              onCheckedChange={() => toggleRule(r.id)}
              accessibilityLabel={t('ruleA11y', { name: ruleLabel(r) })}
            />
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              theme="red"
              onPress={() => removeRule(r.id)}
              accessibilityLabel={t('deleteA11y', { name: ruleLabel(r) })}
            >
              {t('delete')}
            </Button>
          </XStack>
        ))}
      </YStack>
    </Screen>
  );
}
