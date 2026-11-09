import React from 'react';
import Svg, { Circle, G } from 'react-native-svg';
import { YStack, Text } from 'tamagui';
import { useTranslation } from '@/shared/i18n';
import { usePalette } from './usePalette';

interface GaugeProps {
  label: string;
  value?: number | null;
  min?: number;
  max?: number;
  unit?: string;
  size?: number;
}

/** A 270° arc gauge (react-native-svg). One accessible element (plan 20): read as a progress bar
 *  with its label and value text; the arc colours come from the theme (`$accent` on `$gaugeTrack`),
 *  and the big number is capped at 1.3× font scale so it stays inside the arc. */
export function Gauge({ label, value, min = 0, max = 100, unit, size = 150 }: GaugeProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const arc = 0.75; // 270° of the full circle
  const v = value ?? min;
  const pct = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  const hasValue = value !== null && value !== undefined;
  const valueText = hasValue ? `${Math.round(v)}${unit ? ` ${unit}` : ''}` : t('gauge.noReading');

  return (
    <YStack
      alignItems="center"
      gap="$1"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: hasValue ? Math.round(v) : undefined, text: valueText }}
    >
      <Svg width={size} height={size}>
        {/* Rotate so the 90° gap sits at the bottom. */}
        <G rotation={135} originX={cx} originY={cx}>
          <Circle
            cx={cx}
            cy={cx}
            r={r}
            stroke={palette.gaugeTrack}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${circumference * arc} ${circumference}`}
            strokeLinecap="round"
          />
          <Circle
            cx={cx}
            cy={cx}
            r={r}
            stroke={palette.accent}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${circumference * arc * pct} ${circumference}`}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <YStack alignItems="center" marginTop={-size / 2 - 8} height={size / 2}>
        <Text fontSize="$9" fontWeight="900" maxFontSizeMultiplier={1.3}>
          {value === null || value === undefined ? '—' : Math.round(v)}
        </Text>
        {unit ? (
          <Text fontSize="$2" theme="alt2" maxFontSizeMultiplier={1.3}>
            {unit}
          </Text>
        ) : null}
      </YStack>
      <Text fontSize="$3" theme="alt2">
        {label}
      </Text>
    </YStack>
  );
}
