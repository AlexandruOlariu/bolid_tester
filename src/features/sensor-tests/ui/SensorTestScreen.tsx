import React from 'react';
import { YStack, Paragraph, H4, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSensorTestStore } from '../model/sensorTestStore';
import { useSensorTests } from '../hooks/useSensorTests';

export function SensorTestScreen() {
  const { refresh, canModuleSensors, hasMode06 } = useSensorTests();
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

      {canModuleSensors ? (
        <YStack gap="$1">
          <H4>Modules (experimental)</H4>
          <Paragraph theme="alt2" size="$2">
            Unverified, CAN-only. Confirm against the real vehicle before trusting values.
          </Paragraph>
          {moduleReadings.map((m, i) => (
            <Paragraph key={i}>
              {m.name}: {m.value != null ? `${m.value} ${m.unit}` : '—'} · raw {m.raw}
            </Paragraph>
          ))}
        </YStack>
      ) : (
        <Paragraph theme="alt2">No experimental module sensors for this car / protocol.</Paragraph>
      )}
    </Screen>
  );
}
