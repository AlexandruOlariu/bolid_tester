import React from 'react';
import { YStack, XStack, Paragraph, H2, H4, Button, Card, Text } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useInspection } from '../hooks/useInspection';
import { useTranslation } from '@/shared/i18n';

/** Verdict colours; the labels are `inspection:verdict.<verdict>` (plan 11). */
const VERDICT: Record<string, { color: string }> = {
  pass: { color: '$statusOk' },
  caution: { color: '$statusWarn' },
  fail: { color: '$statusError' },
};

const CHECK_COLOR: Record<string, string> = {
  pass: '$statusOk',
  warn: '$statusWarn',
  fail: '$statusError',
  info: '$muted',
};

export function InspectionScreen() {
  const { t } = useTranslation('inspection');
  const status = useSessionStore((s) => s.status);
  const { report, running, run } = useInspection();

  if (status !== 'connected') {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('notConnected')}</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <Button theme="blue" onPress={run} disabled={running}>
        {running ? t('running') : t('run')}
      </Button>

      {report ? (
        <YStack gap="$3">
          <Card bordered padding="$3" backgroundColor="$color2">
            <XStack justifyContent="space-between" alignItems="center">
              <H2 color={VERDICT[report.verdict].color}>{t(`verdict.${report.verdict}`)}</H2>
              <Text fontSize="$8" fontWeight="800">
                {report.score}
              </Text>
            </XStack>
          </Card>
          <YStack gap="$2">
            {report.checks.map((c) => (
              <XStack key={c.id} gap="$3" alignItems="flex-start">
                <Text color={CHECK_COLOR[c.status]} fontWeight="800">
                  ●
                </Text>
                <YStack flex={1}>
                  <H4>{c.label}</H4>
                  <Paragraph theme="alt2" size="$2">
                    {c.detail}
                  </Paragraph>
                </YStack>
              </XStack>
            ))}
          </YStack>
        </YStack>
      ) : null}
    </Screen>
  );
}
