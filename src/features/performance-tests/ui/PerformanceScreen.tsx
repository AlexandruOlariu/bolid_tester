import React from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, HIT_SLOP } from '@/shared/ui';
import { usePerformanceStore } from '../model/performanceStore';
import { usePerformanceTest } from '../hooks/usePerformanceTest';
import { useTranslation } from '@/shared/i18n';
import { formatFixed } from '@/shared/lib/format';

export function PerformanceScreen() {
  const { t } = useTranslation('performanceTests');
  const { stop } = usePerformanceTest();
  const state = usePerformanceStore((s) => s.state);
  const type = usePerformanceStore((s) => s.type);
  const setType = usePerformanceStore((s) => s.setType);
  const setState = usePerformanceStore((s) => s.setState);
  const history = usePerformanceStore((s) => s.history);

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <XStack gap="$2">
        {(['accel', 'drag', 'brake'] as const).map((kind) => (
          <Button
            key={kind}
            size="$3"
            hitSlop={HIT_SLOP}
            theme={type === kind ? 'green' : undefined}
            onPress={() => setType(kind)}
          >
            {t(`type.${kind}`)}
          </Button>
        ))}
      </XStack>

      <XStack gap="$2" alignItems="center">
        <Paragraph flex={1}>
          {t('state', { state: t(`stateName.${state}`, { defaultValue: state }) })}
        </Paragraph>
        {state === 'idle' || state === 'done' ? (
          <Button theme="green" onPress={() => setState('armed')}>
            {t('arm')}
          </Button>
        ) : (
          <Button theme="red" onPress={stop}>
            {t('stop')}
          </Button>
        )}
      </XStack>
      {state === 'armed' ? <Paragraph theme="alt2">{t('armed')}</Paragraph> : null}

      <YStack gap="$2">
        <H4>{t('runs')}</H4>
        {history.map((r) => (
          <Paragraph key={r.id}>
            {r.type === 'accel' && r.accel
              ? t('run.accel', {
                  target: r.accel.targetKmh,
                  time: r.accel.timeMs ? `${formatFixed(r.accel.timeMs / 1000, 2)} s` : '—',
                  rate: formatFixed(r.accel.sampleRateHz, 0),
                })
              : r.type === 'drag' && r.drag
                ? t('run.drag', {
                    result: r.drag.quarterMile
                      ? `${formatFixed(r.drag.quarterMile.timeMs / 1000, 2)} s @ ${formatFixed(r.drag.quarterMile.trapKmh, 0)} km/h`
                      : '—',
                  })
                : r.type === 'brake' && r.brake
                  ? t('run.brake', {
                      result: r.brake.timeMs
                        ? `${formatFixed(r.brake.timeMs / 1000, 2)} s, ${formatFixed(r.brake.distanceM ?? 0, 1)} m`
                        : '—',
                    })
                  : '—'}
          </Paragraph>
        ))}
      </YStack>
    </Screen>
  );
}
