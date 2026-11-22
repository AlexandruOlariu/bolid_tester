import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, UnlockBadge, VerificationBadge } from '@/shared/ui';
import { useUnlockStatus } from '@/shared/security';
import { useServiceResetStore } from '../model/serviceResetStore';
import { useServiceReset } from '../hooks/useServiceReset';
import { useTranslation } from '@/shared/i18n';

export function ServiceResetScreen() {
  const { t } = useTranslation('serviceReset');
  const { available, descriptor, run } = useServiceReset();
  const running = useServiceResetStore((s) => s.running);
  const lastResult = useServiceResetStore((s) => s.lastResult);
  const [confirming, setConfirming] = useState(false);
  const unlock = useUnlockStatus(descriptor?.security, { reqHeader: descriptor?.reqHeader ?? '' });

  if (!available || !descriptor) {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('unavailable')}</Paragraph>
      </Screen>
    );
  }

  // When the profile KNOWS the OBD path cannot reach the module on the real car (e.g. a KWP1281
  // cluster over a generic ELM327), lead with the manual procedure and demote the OBD attempt.
  const obdUnreachable = descriptor.obdUnreachable;

  const manualProcedure =
    descriptor.manualProcedure && descriptor.manualProcedure.length > 0 ? (
      <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
        <H4>{obdUnreachable ? t('manualRecommended') : t('manual')}</H4>
        <Paragraph theme="alt2" size="$2">
          {obdUnreachable ? t('manualReliable') : t('manualFallback')}
        </Paragraph>
        {descriptor.manualProcedure.map((step, i) => (
          <Paragraph key={i} size="$2">
            {i + 1}. {step}
          </Paragraph>
        ))}
      </YStack>
    ) : null;

  const resetButton = !confirming ? (
    <Button
      theme={obdUnreachable ? undefined : 'red'}
      onPress={() => setConfirming(true)}
      disabled={running}
    >
      {obdUnreachable ? t('tryAnyway') : t('reset')}
    </Button>
  ) : (
    <XStack gap="$2">
      <Button
        flex={1}
        theme="red"
        disabled={running}
        onPress={async () => {
          setConfirming(false);
          await run();
        }}
      >
        {running ? t('resetting') : t('confirm')}
      </Button>
      <Button flex={1} onPress={() => setConfirming(false)} disabled={running}>
        {t('common:actions.cancel')}
      </Button>
    </XStack>
  );

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
        <H4>{descriptor.module}</H4>
        <Paragraph theme="alt2" size="$2">
          {t('method', { method: descriptor.method })}
          {descriptor.routineId ? ` · ${t('routine', { id: descriptor.routineId })}` : ''} ·{' '}
          {t('header', { header: descriptor.reqHeader })}
        </Paragraph>
        <VerificationBadge item={descriptor} testID="verify-service-reset" />
        <UnlockBadge status={unlock} testID="unlock-service-reset" />
        {obdUnreachable ? (
          <Paragraph theme="alt1" size="$2">
            ⚠ {obdUnreachable}
          </Paragraph>
        ) : null}
      </YStack>

      {lastResult ? <Paragraph>{lastResult}</Paragraph> : null}

      {obdUnreachable ? (
        <>
          {manualProcedure}
          {resetButton}
        </>
      ) : (
        <>
          {resetButton}
          {manualProcedure}
        </>
      )}
    </Screen>
  );
}
