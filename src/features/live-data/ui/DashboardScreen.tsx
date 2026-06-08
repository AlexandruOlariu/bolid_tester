import React from 'react';
import { YStack, XStack, Paragraph } from 'tamagui';
import { Screen, Gauge, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useLiveData } from '../hooks/useLiveData';

const GAUGES: { pid: string; label: string; min: number; max: number; unit: string }[] = [
  { pid: '010C', label: 'RPM', min: 0, max: 6000, unit: 'rpm' },
  { pid: '010D', label: 'Speed', min: 0, max: 220, unit: 'km/h' },
  { pid: '0105', label: 'Coolant', min: -40, max: 130, unit: '°C' },
];

export function DashboardScreen() {
  const status = useSessionStore((s) => s.status);
  const { values } = useLiveData();
  const gaugePids = new Set(GAUGES.map((g) => g.pid));
  const others = Object.values(values).filter((v) => !gaugePids.has(v.pid));

  if (status !== 'connected') {
    return (
      <Screen title="Live data">
        <Paragraph theme="alt2">Not connected. Connect an adapter or the simulator first.</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title="Live data" subtitle="Streaming the parameters this ECU supports">
      <XStack flexWrap="wrap" justifyContent="space-around" gap="$2">
        {GAUGES.map((g) => (
          <Gauge
            key={g.pid}
            label={g.label}
            value={values[g.pid]?.value ?? null}
            min={g.min}
            max={g.max}
            unit={g.unit}
          />
        ))}
      </XStack>

      <YStack gap="$2">
        <XStack flexWrap="wrap" gap="$2">
          {others.map((v) => (
            <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
          ))}
        </XStack>
        {others.length === 0 ? (
          <Paragraph theme="alt2">Reading…</Paragraph>
        ) : null}
      </YStack>
    </Screen>
  );
}
