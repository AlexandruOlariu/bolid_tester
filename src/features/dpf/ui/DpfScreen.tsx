import React, { useEffect } from 'react';
import { XStack, Paragraph, H3, Button, Card } from 'tamagui';
import { Screen, ValueCard } from '@/shared/ui';
import { allConfirmed } from '@/shared/vehicles';
import { useDpf } from '../hooks/useDpf';
import { useTranslation } from '@/shared/i18n';

/** Status colours; the labels are `dpf:status.<status>` (plan 11). */
const STATUS: Record<string, { color: string }> = {
  ok: { color: '$accent' },
  filling: { color: '$statusOk' },
  'regen-due': { color: '$statusWarn' },
  regenerating: { color: '$statusInfo' },
  high: { color: '$statusError' },
  unknown: { color: '$muted' },
};

export function DpfScreen() {
  const { t } = useTranslation('dpf');
  const { available, values, report, running, refresh, dieselPids } = useDpf();

  useEffect(() => {
    if (available) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  if (!available) {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('unavailable')}</Paragraph>
      </Screen>
    );
  }

  const statusId = report && STATUS[report.status] ? report.status : 'unknown';
  const s = STATUS[statusId];
  return (
    <Screen
      title={t('title')}
      subtitle={allConfirmed(dieselPids) ? t('allConfirmed') : t('experimental')}
    >
      <Card bordered padding="$3" backgroundColor="$color2">
        <H3 color={s.color}>{t(`status.${statusId}`)}</H3>
        {report?.sootPct != null ? (
          <Paragraph>{t('soot', { pct: report.sootPct })}</Paragraph>
        ) : null}
        {report?.advice ? (
          <Paragraph theme="alt2" size="$2">
            {report.advice}
          </Paragraph>
        ) : null}
      </Card>

      <Button theme="blue" onPress={refresh} disabled={running}>
        {running ? t('reading') : t('refresh')}
      </Button>

      <XStack flexWrap="wrap" gap="$2">
        {values.map((v) => (
          <ValueCard key={v.did} name={v.name} value={v.value} unit={v.unit} />
        ))}
      </XStack>
    </Screen>
  );
}
