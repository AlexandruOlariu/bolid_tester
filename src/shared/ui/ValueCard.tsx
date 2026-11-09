import React from 'react';
import { useWindowDimensions } from 'react-native';
import { Card, YStack, XStack, Text, Paragraph } from 'tamagui';

/** Above this OS font scale a value card takes the whole row (plan 20): two 150 dp tiles side by
 *  side cannot hold a 2× number and its unit. */
export const LARGE_TEXT_FONT_SCALE = 1.5;

interface ValueCardProps {
  name: string;
  value?: number | string | null;
  unit?: string;
  stale?: boolean;
  /** Fixed width in dp instead of growing to fill the row (plan 21: the two-pane Live grid computes
   *  it from the measured column so the cards fill each row exactly). Replaces the 150 dp minimum. */
  width?: number;
  /** One card per row. Defaults to on above `LARGE_TEXT_FONT_SCALE` (plan 20), so every grid of
   *  value cards — Live, All sensors, Faults, Battery … — wraps to one column with large text.
   *  Ignored when `width` is set. */
  fullWidth?: boolean;
}

/** Compact live-parameter tile. */
export function ValueCard({ name, value, unit, stale, width, fullWidth }: ValueCardProps) {
  const { fontScale } = useWindowDimensions();
  const oneColumn = fullWidth ?? fontScale > LARGE_TEXT_FONT_SCALE;
  const display =
    value === null || value === undefined
      ? '—'
      : typeof value === 'number'
        ? formatNumber(value)
        : value;
  const a11yLabel = `${name}: ${display}${unit ? ` ${unit}` : ''}${stale ? ' (stale)' : ''}`;
  return (
    <Card
      elevate
      bordered
      padding="$3"
      {...(width !== undefined
        ? { width, flexGrow: 0, flexShrink: 0 }
        : oneColumn
          ? { width: '100%' as const }
          : { minWidth: 150, flex: 1 })}
      opacity={stale ? 0.5 : 1}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
    >
      <YStack gap="$1">
        <Paragraph theme="alt2" fontSize="$2" numberOfLines={1}>
          {name}
        </Paragraph>
        <XStack alignItems="baseline" gap="$1">
          {/* Display number: capped at 1.3× font scale so the tile does not overflow (plan 20). */}
          <Text fontSize="$8" fontWeight="800" maxFontSizeMultiplier={1.3} numberOfLines={1}>
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
