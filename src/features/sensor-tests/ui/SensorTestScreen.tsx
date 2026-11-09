import React from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, VerificationBadge } from '@/shared/ui';
import { useSensorTestStore } from '../model/sensorTestStore';
import { useSensorTests } from '../hooks/useSensorTests';

export function SensorTestScreen() {
  const { refresh, canModuleSensors, kline, fuel, hasMode06 } = useSensorTests();
  const mode05 = useSensorTestStore((s) => s.mode05);
  const mode06 = useSensorTestStore((s) => s.mode06);
  const moduleReadings = useSensorTestStore((s) => s.moduleReadings);

  return (
    <Screen title="Sensor tests" subtitle="Mode 06 monitors + experimental module sensors">
      <Button theme="green" onPress={() => void refresh()}>
        Run tests
      </Button>

      {hasMode06 ? (
        <YStack gap="$1">
          <H4>Mode 06 (powertrain)</H4>
          {mode06.map((r, i) => (
            <Paragraph key={i} color={r.pass ? '$green11' : '$red11'}>
              MID {r.mid.toString(16)} · {r.value.toFixed(1)} {r.unit} (min {r.min.toFixed(1)} / max{' '}
              {r.max.toFixed(1)}) · {r.pass ? 'PASS' : 'FAIL'}
            </Paragraph>
          ))}
        </YStack>
      ) : null}

      {kline && fuel !== 'diesel' ? (
        <YStack gap="$1">
          <H4>Mode 05 (O2 sensors, pre-CAN)</H4>
          {mode05.length ? (
            mode05.map((r, i) => (
              <Paragraph key={i}>
                {r.name} · sensor {r.sensor} ·{' '}
                {r.volts !== null
                  ? `${r.volts.toFixed(3)} V`
                  : `raw ${r.values.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`}
              </Paragraph>
            ))
          ) : (
            <Paragraph theme="alt2" size="$2">
              No Mode 05 results yet — run tests (many ECUs do not support it).
            </Paragraph>
          )}
        </YStack>
      ) : null}

      {canModuleSensors ? (
        <YStack gap="$1">
          <H4>Modules (experimental)</H4>
          <Paragraph theme="alt2" size="$2">
            CAN-only, per-car addressing. Trust a value only once its badge says it was confirmed on
            this car.
          </Paragraph>
          {moduleReadings.map((m, i) => (
            <XStack key={i} gap="$2" alignItems="center" flexWrap="wrap">
              <Paragraph>
                {m.name}: {m.value != null ? `${m.value} ${m.unit}` : '—'} · raw {m.raw}
              </Paragraph>
              <VerificationBadge
                item={{ experimental: true, confirmed: m.confirmed }}
                testID={`verify-sensor-${i}`}
              />
            </XStack>
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">No experimental module sensors for this car / protocol.</Paragraph>
      )}
    </Screen>
  );
}
