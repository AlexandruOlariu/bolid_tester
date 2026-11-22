import React from 'react';
import { YStack, XStack, Paragraph, H3, Button, Card, Text, Spinner } from 'tamagui';
import { Screen, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { communitySummary, matchKnownAdapter } from '@/shared/adapters';
import { useAdapterHealth } from '../hooks/useAdapterHealth';
import { useTranslation } from '@/shared/i18n';
import { formatFixed } from '@/shared/lib/format';

const GRADE_COLOR: Record<string, string> = {
  good: '$statusOk',
  ok: '$statusWarn',
  poor: '$statusError',
};

export function AdapterHealthScreen() {
  const { t } = useTranslation('adapterHealth');
  const status = useSessionStore((s) => s.status);
  const { running, phase, report, run, share, sharing } = useAdapterHealth();

  if (status !== 'connected') {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('notConnected')}</Paragraph>
      </Screen>
    );
  }

  const latency = report?.result.latency ?? null;
  // The adapter the run was made on, not whatever is connected now.
  const known = report ? matchKnownAdapter(report.context.deviceName, report.version) : null;

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <Button theme="green" onPress={run} disabled={running}>
        {running ? (phase ?? t('running')) : report ? t('runAgain') : t('run')}
      </Button>
      {running ? (
        <XStack alignItems="center" gap="$2">
          <Spinner />
          <Paragraph theme="alt2" size="$2">
            {phase}
          </Paragraph>
        </XStack>
      ) : null}

      {report ? (
        <YStack gap="$3">
          <XStack alignItems="center" gap="$2">
            <H3 color={GRADE_COLOR[report.result.grade]}>
              {t(`grade.${report.result.grade}`, {
                defaultValue: report.result.grade.toUpperCase(),
              })}
            </H3>
            {report.result.cloneSuspected ? (
              <Paragraph theme="alt2">· {t('clone')}</Paragraph>
            ) : null}
          </XStack>
          <Paragraph theme="alt2" size="$2" testID="adapter-community">
            {known ? t('community', { summary: communitySummary(known) }) : t('noCommunity')}
          </Paragraph>

          <Card bordered padding="$3">
            <YStack gap="$1.5">
              <XStack justifyContent="space-between">
                <Paragraph theme="alt2">{t('firmware')}</Paragraph>
                <Text fontWeight="700">{report.version || '—'}</Text>
              </XStack>
              <XStack justifyContent="space-between">
                <Paragraph theme="alt2">{t('voltage')}</Paragraph>
                <Text fontWeight="700">
                  {report.voltage == null ? '—' : `${formatFixed(report.voltage, 1)} V`}
                </Text>
              </XStack>
              <XStack justifyContent="space-between">
                <Paragraph theme="alt2">{t('protocol')}</Paragraph>
                <Text fontWeight="700">{report.protocol}</Text>
              </XStack>
            </YStack>
          </Card>

          <XStack flexWrap="wrap" gap="$2">
            <ValueCard
              name={t('minLatency')}
              value={latency ? Math.round(latency.min) : null}
              unit="ms"
            />
            <ValueCard
              name={t('medianLatency')}
              value={latency ? Math.round(latency.median) : null}
              unit="ms"
            />
            <ValueCard
              name={t('maxLatency')}
              value={latency ? Math.round(latency.max) : null}
              unit="ms"
            />
          </XStack>
          <Paragraph theme="alt2" size="$2">
            {t('answered', { done: latency ? latency.count : 0, total: report.attempts })}
          </Paragraph>

          <YStack gap="$1">
            {report.result.notes.map((n, i) => (
              <Paragraph key={i} theme="alt2" size="$2">
                • {n}
              </Paragraph>
            ))}
          </YStack>

          <Button
            theme="blue"
            onPress={() => share('txt')}
            disabled={sharing}
            icon={sharing ? () => <Spinner /> : undefined}
          >
            {t('shareText')}
          </Button>
          <Button onPress={() => share('json')} disabled={sharing}>
            {t('shareJson')}
          </Button>
        </YStack>
      ) : null}
    </Screen>
  );
}
