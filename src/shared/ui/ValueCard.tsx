import React from 'react';
import { Card, YStack, XStack, Text, Paragraph } from 'tamagui';

interface ValueCardProps {
  name: string;
  value?: number | string | null;
  unit?: string;
  stale?: boolean;
}

/** Compact live-parameter tile. */
export function ValueCard({ name, value, unit, stale }: ValueCardProps) {
  const display =
    value === null || value === undefined
      ? '—'
      : typeof value === 'number'
        ? formatNumber(value)
        : value;
  return (
    <Card elevate bordered padding="$3" minWidth={150} flex={1} opacity={stale ? 0.5 : 1}>
      <YStack gap="$1">
        <Paragraph theme="alt2" fontSize="$2" numberOfLines={1}>
          {name}
        </Paragraph>
        <XStack alignItems="baseline" gap="$1">
          <Text fontSize="$8" fontWeight="800">
            {display}
          </Text>
          {unit ? (
            <Text fontSize="$3" theme="alt2">
              {unit}
            </Text>
          ) : null}
        </XStack>
      </YStack>
    </Card>
  );
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(Math.abs(n) < 10 ? 1 : 0);
}
