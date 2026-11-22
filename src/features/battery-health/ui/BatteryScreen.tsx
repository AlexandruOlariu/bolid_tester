import React from 'react';
import { YStack, XStack, Paragraph, H3, Button, Card, Text } from 'tamagui';
import { Screen, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useBatteryHealth } from '../hooks/useBatteryHealth';
import { useTranslation } from '@/shared/i18n';
import { formatFixed } from '@/shared/lib/format';

const VERDICT_COLOR: Record<string, string> = {
  good: '$statusOk',
  fair: '$statusWarn',
  weak: '$statusError',
  unknown: '$muted',
};

function volts(v: number | null): string | null {
  return v == null ? null : formatFixed(v, 2);
}

export function BatteryScreen() {
  const { t } = useTranslation('batteryHealth');
  const status = useSessionStore((s) => s.status);
  const { capturing, report, liveV, capture } = useBatteryHealth();

  if (status !== 'connected') {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('notConnected')}</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <Card bordered padding="$3">
        <XStack justifyContent="space-between" alignItems="center">
          <Paragraph theme="alt2">{t('live')}</Paragraph>
          <Text fontSize="$7" fontWeight="800">
            {liveV != null ? `${formatFixed(liveV, 1)} V` : '—'}
          </Text>
        </XStack>
      </Card>

      <Button theme="green" onPress={capture} disabled={capturing}>
        {capturing ? t('capturing') : t('capture')}
      </Button>

      {report ? (
        <YStack gap="$3">
          <XStack alignItems="center" gap="$2">
            <H3 color={VERDICT_COLOR[report.verdict]}>
              {t(`verdict.${report.verdict}`, { defaultValue: report.verdict.toUpperCase() })}
            </H3>
            {report.socPct != null ? (
              <Paragraph theme="alt2">· {t('charge', { pct: report.socPct })}</Paragraph>
            ) : null}
          </XStack>
          <XStack flexWrap="wrap" gap="$2">
            <ValueCard name={t('resting')} value={volts(report.restingV)} unit="V" />
            <ValueCard name={t('crankDip')} value={volts(report.crankingDipV)} unit="V" />
            <ValueCard name={t('charging')} value={volts(report.chargingV)} unit="V" />
          </XStack>
          <YStack gap="$1">
            {report.notes.map((n, i) => (
              <Paragraph key={i} theme="alt2" size="$2">
                • {n}
              </Paragraph>
            ))}
          </YStack>
        </YStack>
      ) : null}
    </Screen>
  );
}
