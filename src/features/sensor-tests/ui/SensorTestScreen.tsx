import React from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, VerificationBadge } from '@/shared/ui';
import { useSensorTestStore } from '../model/sensorTestStore';
import { useSensorTests } from '../hooks/useSensorTests';
import { useTranslation } from '@/shared/i18n';
import { formatFixed } from '@/shared/lib/format';

export function SensorTestScreen() {
  const { t } = useTranslation('sensorTests');
  const { refresh, canModuleSensors, kline, fuel, hasMode06 } = useSensorTests();
  const mode05 = useSensorTestStore((s) => s.mode05);
  const mode06 = useSensorTestStore((s) => s.mode06);
  const moduleReadings = useSensorTestStore((s) => s.moduleReadings);

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <Button theme="green" onPress={() => void refresh()}>
        {t('run')}
      </Button>

      {hasMode06 ? (
        <YStack gap="$1">
          <H4>{t('mode06')}</H4>
          {mode06.map((r, i) => (
            <Paragraph key={i} color={r.pass ? '$green11' : '$red11'}>
              {t('mode06Row', {
                mid: r.mid.toString(16),
                value: formatFixed(r.value, 1),
                unit: r.unit,
                min: formatFixed(r.min, 1),
                max: formatFixed(r.max, 1),
                result: r.pass ? t('pass') : t('fail'),
              })}
            </Paragraph>
          ))}
        </YStack>
      ) : null}

      {kline && fuel !== 'diesel' ? (
        <YStack gap="$1">
          <H4>{t('mode05')}</H4>
          {mode05.length ? (
            mode05.map((r, i) => (
              <Paragraph key={i}>
                {r.name} · {t('sensor', { n: r.sensor })} ·{' '}
                {r.volts !== null
                  ? `${formatFixed(r.volts, 3)} V`
                  : t('raw', {
                      raw: r.values.map((b) => b.toString(16).padStart(2, '0')).join(' '),
                    })}
              </Paragraph>
            ))
          ) : (
            <Paragraph theme="alt2" size="$2">
              {t('noMode05')}
            </Paragraph>
          )}
        </YStack>
      ) : null}

      {canModuleSensors ? (
        <YStack gap="$1">
          <H4>{t('modules')}</H4>
          <Paragraph theme="alt2" size="$2">
            {t('modulesHelp')}
          </Paragraph>
          {moduleReadings.map((m, i) => (
            <XStack key={i} gap="$2" alignItems="center" flexWrap="wrap">
              <Paragraph>
                {m.name}: {m.value != null ? `${m.value} ${m.unit}` : '—'} ·{' '}
                {t('raw', { raw: m.raw })}
              </Paragraph>
              <VerificationBadge
                item={{ experimental: true, confirmed: m.confirmed }}
                testID={`verify-sensor-${i}`}
              />
            </XStack>
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">{t('noModules')}</Paragraph>
      )}
    </Screen>
  );
}
