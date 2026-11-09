import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, UnlockBadge, VerificationBadge, AccessibleSwitch } from '@/shared/ui';
import { useUnlockStatus } from '@/shared/security';
import type { GuidedRoutine } from '@/shared/vehicles';
import { useRoutinesStore } from '../model/routinesStore';
import { useRoutines } from '../hooks/useRoutines';
import { useTranslation } from '@/shared/i18n';

function RoutineRow({ routine }: { routine: GuidedRoutine }) {
  const { t } = useTranslation('routines');
  const { start, stop } = useRoutines();
  const unlocked = useRoutinesStore((s) => s.unlocked);
  const activeId = useRoutinesStore((s) => s.activeId);
  const phase = useRoutinesStore((s) => s.phase);
  const liveValues = useRoutinesStore((s) => s.liveValues);
  const [confirming, setConfirming] = useState(false);

  const unlock = useUnlockStatus(routine.security, { reqHeader: routine.reqHeader });
  const isActive = activeId === routine.id;
  const busy = activeId !== null;

  return (
    <YStack gap="$2" backgroundColor="$color2" padding="$3" borderRadius="$4">
      <H4>{routine.name}</H4>
      <Paragraph theme="alt2" size="$2">
        {routine.module} ·{' '}
        {routine.kind === 'outputTest' ? t('row.outputTest') : t('row.basicSetting')} ·{' '}
        {t('row.id', { id: routine.id })}
        {routine.vcdsGroup !== undefined
          ? ` · ${t('row.vcdsGroup', { group: routine.vcdsGroup })}`
          : ''}
      </Paragraph>
      <VerificationBadge item={routine} testID={`verify-routine-${routine.id}`} />
      <UnlockBadge status={unlock} testID={`unlock-routine-${routine.id}`} />
      {unlock.state === 'locked' ? (
        <Paragraph theme="alt2" size="$2">
          {t('row.lockedNote')}
        </Paragraph>
      ) : null}
      <Paragraph size="$2">{routine.description}</Paragraph>
      {routine.unavailableReason ? (
        <Paragraph theme="alt1" size="$2">
          ⚠ {routine.unavailableReason}
        </Paragraph>
      ) : null}

      {isActive && phase === 'running' ? (
        <YStack gap="$2">
          {liveValues.map((v) => (
            <XStack key={v.name} justifyContent="space-between">
              <Paragraph theme="alt2" size="$2">
                {v.name}
              </Paragraph>
              <Paragraph size="$2">
                {v.value}
                {v.unit}
              </Paragraph>
            </XStack>
          ))}
          <Button theme="red" onPress={() => stop(routine)}>
            {routine.kind === 'outputTest' ? t('row.stopOutput') : t('row.stopRoutine')}
          </Button>
        </YStack>
      ) : !confirming ? (
        <Button disabled={!unlocked || busy} onPress={() => setConfirming(true)}>
          {!unlocked
            ? t('row.locked')
            : routine.unavailableReason
              ? t('row.attemptAnyway')
              : t('row.start')}
        </Button>
      ) : (
        <YStack gap="$2" backgroundColor="$color1" padding="$2" borderRadius="$3">
          <Paragraph size="$2">{t('row.confirmText')}</Paragraph>
          <XStack gap="$2">
            <Button
              flex={1}
              theme="red"
              onPress={() => {
                setConfirming(false);
                void start(routine);
              }}
            >
              {t('row.checkAndStart')}
            </Button>
            <Button flex={1} onPress={() => setConfirming(false)}>
              {t('common:actions.cancel')}
            </Button>
          </XStack>
        </YStack>
      )}
    </YStack>
  );
}

export function RoutinesScreen() {
  const { t } = useTranslation('routines');
  const { available, routines } = useRoutines();
  const unlocked = useRoutinesStore((s) => s.unlocked);
  const setUnlocked = useRoutinesStore((s) => s.setUnlocked);
  const phase = useRoutinesStore((s) => s.phase);
  const message = useRoutinesStore((s) => s.message);
  const interlockFailures = useRoutinesStore((s) => s.interlockFailures);

  if (!available) {
    return (
      <Screen title={t('title')}>
        <Paragraph theme="alt2">{t('unavailable')}</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <XStack
        alignItems="center"
        justifyContent="space-between"
        backgroundColor="$color2"
        padding="$3"
        borderRadius="$4"
      >
        <YStack flex={1}>
          <H4>{t('unlock')}</H4>
          <Paragraph theme="alt2" size="$2">
            {t('unlockHelp')}
          </Paragraph>
        </YStack>
        <AccessibleSwitch
          checked={unlocked}
          onCheckedChange={setUnlocked}
          accessibilityLabel={t('unlock')}
        />
      </XStack>

      {message ? <Paragraph>{message}</Paragraph> : null}
      {phase === 'blocked' && interlockFailures.length ? (
        <YStack backgroundColor="$color2" padding="$3" borderRadius="$4" gap="$1">
          <H4>{t('blocked')}</H4>
          {interlockFailures.map((f) => (
            <Paragraph key={f} size="$2">
              • {f}
            </Paragraph>
          ))}
        </YStack>
      ) : null}

      {routines.map((r) => (
        <RoutineRow key={r.id} routine={r} />
      ))}
    </Screen>
  );
}
