import React from 'react';
import Svg, { Circle, G } from 'react-native-svg';
import { YStack, Text } from 'tamagui';

interface GaugeProps {
  label: string;
  value?: number | null;
  min?: number;
  max?: number;
  unit?: string;
  size?: number;
}

/** A 270° arc gauge (react-native-svg). */
export function Gauge({ label, value, min = 0, max = 100, unit, size = 150 }: GaugeProps) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const arc = 0.75; // 270° of the full circle
  const v = value ?? min;
  const pct = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));

  return (
    <YStack alignItems="center" gap="$1">
      <Svg width={size} height={size}>
        {/* Rotate so the 90° gap sits at the bottom. */}
        <G rotation={135} originX={cx} originY={cx}>
          <Circle
            cx={cx}
            cy={cx}
            r={r}
            stroke="#3a3a3a"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${circumference * arc} ${circumference}`}
            strokeLinecap="round"
          />
          <Circle
            cx={cx}
            cy={cx}
            r={r}
            stroke="#2bb673"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${circumference * arc * pct} ${circumference}`}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <YStack alignItems="center" marginTop={-size / 2 - 8} height={size / 2}>
        <Text fontSize="$9" fontWeight="900">
          {value === null || value === undefined ? '—' : Math.round(v)}
        </Text>
        {unit ? (
          <Text fontSize="$2" theme="alt2">
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
