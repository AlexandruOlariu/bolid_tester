import React from 'react';
import { YStack, XStack, Paragraph, H2, H4, Button, Card, Text } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useInspection } from '../hooks/useInspection';

const VERDICT: Record<string, { color: string; label: string }> = {
  pass: { color: '#2bb673', label: 'PASS' },
  caution: { color: '#d29922', label: 'CAUTION' },
  fail: { color: '#f85149', label: 'FAIL' },
};

const CHECK_COLOR: Record<string, string> = {
  pass: '#2bb673',
  warn: '#d29922',
  fail: '#f85149',
  info: '#8B949E',
};

export function InspectionScreen() {
  const status = useSessionStore((s) => s.status);
  const { report, running, run } = useInspection();

  if (status !== 'connected') {
    return (
      <Screen title="Used-car inspection">
        <Paragraph theme="alt2">Connect to the car (or the simulator) to run an inspection.</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen
      title="Used-car inspection"
      subtitle="Screens the engine/emissions ECU — not a mechanical check."
    >
      <Button theme="blue" onPress={run} disabled={running}>
        {running ? 'Running…' : 'Run inspection'}
      </Button>

      {report ? (
        <YStack gap="$3">
          <Card bordered padding="$3" backgroundColor="$color2">
            <XStack justifyContent="space-between" alignItems="center">
              <H2 color={VERDICT[report.verdict].color}>{VERDICT[report.verdict].label}</H2>
              <Text fontSize="$8" fontWeight="800">
                {report.score}
              </Text>
            </XStack>
          </Card>
          <YStack gap="$2">
            {report.checks.map((c) => (
              <XStack key={c.id} gap="$3" alignItems="flex-start">
                <Text color={CHECK_COLOR[c.status]} fontWeight="800">
                  ●
                </Text>
                <YStack flex={1}>
                  <H4>{c.label}</H4>
                  <Paragraph theme="alt2" size="$2">
                    {c.detail}
                  </Paragraph>
                </YStack>
              </XStack>
            ))}
          </YStack>
        </YStack>
      ) : null}
    </Screen>
  );
}
