import React from 'react';
import { YStack, XStack, Paragraph, H3, Button, Card, Text, Spinner } from 'tamagui';
import { Screen, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useAdapterHealth } from '../hooks/useAdapterHealth';

const GRADE_COLOR: Record<string, string> = {
  good: '#2bb673',
  ok: '#d29922',
  poor: '#f85149',
};

export function AdapterHealthScreen() {
  const status = useSessionStore((s) => s.status);
  const { running, phase, report, run, share, sharing } = useAdapterHealth();

  if (status !== 'connected') {
    return (
      <Screen title="Adapter health">
        <Paragraph theme="alt2">
          Connect to a car (or the simulator) to test the adapter. This times a burst of commands and
          grades your ELM327.
        </Paragraph>
      </Screen>
    );
  }

  const latency = report?.result.latency ?? null;

  return (
    <Screen title="Adapter health" subtitle="Firmware, voltage, protocol & latency — is my clone junk?">
      <Button theme="green" onPress={run} disabled={running}>
        {running ? (phase ?? 'Running…') : report ? 'Run again' : 'Run health check (~5 s)'}
      </Button>
      {running ? (
        <XStack alignItems="center" gap="$2">
          <Spinner />
          <Paragraph theme="alt2" size="$2">
            {phase}
          </Paragraph>
        </XStack>
      ) : null}

      {report ? (
        <YStack gap="$3">
          <XStack alignItems="center" gap="$2">
            <H3 color={GRADE_COLOR[report.result.grade]}>{report.result.grade.toUpperCase()}</H3>
            {report.result.cloneSuspected ? (
              <Paragraph theme="alt2">· clone suspected</Paragraph>
            ) : null}
          </XStack>

          <Card bordered padding="$3">
            <YStack gap="$1.5">
              <XStack justifyContent="space-between">
                <Paragraph theme="alt2">Firmware</Paragraph>
                <Text fontWeight="700">{report.version || '—'}</Text>
              </XStack>
              <XStack justifyContent="space-between">
                <Paragraph theme="alt2">Voltage</Paragraph>
                <Text fontWeight="700">{report.voltage == null ? '—' : `${report.voltage.toFixed(1)} V`}</Text>
              </XStack>
              <XStack justifyContent="space-between">
                <Paragraph theme="alt2">Protocol</Paragraph>
                <Text fontWeight="700">{report.protocol}</Text>
              </XStack>
            </YStack>
          </Card>

          <XStack flexWrap="wrap" gap="$2">
            <ValueCard name="Min latency" value={latency ? Math.round(latency.min) : null} unit="ms" />
            <ValueCard name="Median latency" value={latency ? Math.round(latency.median) : null} unit="ms" />
            <ValueCard name="Max latency" value={latency ? Math.round(latency.max) : null} unit="ms" />
          </XStack>
          <Paragraph theme="alt2" size="$2">
            {latency ? `${latency.count}/${report.attempts}` : `0/${report.attempts}`} 0100 commands answered
          </Paragraph>

          <YStack gap="$1">
            {report.result.notes.map((n, i) => (
              <Paragraph key={i} theme="alt2" size="$2">
                • {n}
              </Paragraph>
            ))}
          </YStack>

          <Button theme="blue" onPress={share} disabled={sharing} icon={sharing ? () => <Spinner /> : undefined}>
            Share as text
          </Button>
        </YStack>
      ) : null}
    </Screen>
  );
}
