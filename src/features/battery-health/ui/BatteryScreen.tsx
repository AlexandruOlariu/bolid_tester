import React from 'react';
import { YStack, XStack, Paragraph, H3, Button, Card, Text } from 'tamagui';
import { Screen, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useBatteryHealth } from '../hooks/useBatteryHealth';

const VERDICT_COLOR: Record<string, string> = {
  good: '#2bb673',
  fair: '#d29922',
  weak: '#f85149',
  unknown: '#8B949E',
};

function volts(v: number | null): string | null {
  return v == null ? null : v.toFixed(2);
}

export function BatteryScreen() {
  const status = useSessionStore((s) => s.status);
  const { capturing, report, liveV, capture } = useBatteryHealth();

  if (status !== 'connected') {
    return (
      <Screen title="Battery & charging">
        <Paragraph theme="alt2">Connect to a car (or the simulator) to capture voltage.</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title="Battery & charging" subtitle="Voltage-based health — not a load test.">
      <Card bordered padding="$3">
        <XStack justifyContent="space-between" alignItems="center">
          <Paragraph theme="alt2">Live voltage</Paragraph>
          <Text fontSize="$7" fontWeight="800">{liveV != null ? `${liveV.toFixed(1)} V` : '—'}</Text>
        </XStack>
      </Card>

      <Button theme="green" onPress={capture} disabled={capturing}>
        {capturing ? 'Capturing… (start the engine to catch the crank dip)' : 'Capture (~6 s)'}
      </Button>

      {report ? (
        <YStack gap="$3">
          <XStack alignItems="center" gap="$2">
            <H3 color={VERDICT_COLOR[report.verdict]}>{report.verdict.toUpperCase()}</H3>
            {report.socPct != null ? <Paragraph theme="alt2">· {report.socPct}% charge</Paragraph> : null}
          </XStack>
          <XStack flexWrap="wrap" gap="$2">
            <ValueCard name="Resting" value={volts(report.restingV)} unit="V" />
            <ValueCard name="Crank dip" value={volts(report.crankingDipV)} unit="V" />
            <ValueCard name="Charging" value={volts(report.chargingV)} unit="V" />
          </XStack>
          <YStack gap="$1">
            {report.notes.map((n, i) => (
              <Paragraph key={i} theme="alt2" size="$2">
                • {n}
              </Paragraph>
            ))}
          </YStack>
        </YStack>
      ) : null}
    </Screen>
  );
}
