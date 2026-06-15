import React from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { usePerformanceStore } from '../model/performanceStore';
import { usePerformanceTest } from '../hooks/usePerformanceTest';

export function PerformanceScreen() {
  const { stop } = usePerformanceTest();
  const state = usePerformanceStore((s) => s.state);
  const type = usePerformanceStore((s) => s.type);
  const setType = usePerformanceStore((s) => s.setType);
  const setState = usePerformanceStore((s) => s.setState);
  const history = usePerformanceStore((s) => s.history);

  return (
    <Screen title="Performance" subtitle="Closed-course use only — keep your eyes on the road">
      <XStack gap="$2">
        {(['accel', 'drag', 'brake'] as const).map((t) => (
          <Button key={t} size="$2" theme={type === t ? 'green' : undefined} onPress={() => setType(t)}>
            {t === 'accel' ? '0–100' : t === 'drag' ? '¼ mile' : 'Braking'}
          </Button>
        ))}
      </XStack>

      <XStack gap="$2" alignItems="center">
        <Paragraph flex={1}>State: {state}</Paragraph>
        {state === 'idle' || state === 'done' ? (
          <Button theme="green" onPress={() => setState('armed')}>
            Arm
          </Button>
        ) : (
          <Button theme="red" onPress={stop}>
            Stop
          </Button>
        )}
      </XStack>
      {state === 'armed' ? <Paragraph theme="alt2">Armed — launch detected on first movement.</Paragraph> : null}

      <YStack gap="$2">
        <H4>Runs</H4>
        {history.map((r) => (
          <Paragraph key={r.id}>
            {r.type === 'accel' && r.accel
              ? `0–${r.accel.targetKmh}: ${r.accel.timeMs ? (r.accel.timeMs / 1000).toFixed(2) + ' s' : '—'} (${r.accel.sampleRateHz.toFixed(0)} Hz)`
              : r.type === 'drag' && r.drag
                ? `¼ mile: ${r.drag.quarterMile ? (r.drag.quarterMile.timeMs / 1000).toFixed(2) + ' s @ ' + r.drag.quarterMile.trapKmh.toFixed(0) + ' km/h' : '—'}`
                : r.type === 'brake' && r.brake
                  ? `Brake: ${r.brake.timeMs ? (r.brake.timeMs / 1000).toFixed(2) + ' s, ' + (r.brake.distanceM ?? 0).toFixed(1) + ' m' : '—'}`
                  : '—'}
          </Paragraph>
        ))}
      </YStack>
    </Screen>
  );
}
