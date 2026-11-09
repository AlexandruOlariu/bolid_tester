/** Speed-over-time strip for the trip detail screen (plan 17): an SVG polyline of `speedProfile`
 *  (010D, else GPS speed; at most 300 points) with metric axis labels. */
import React, { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import { Paragraph, Text, XStack, YStack } from 'tamagui';

const HEIGHT = 90;
const PAD_X = 4;
const PAD_Y = 6;
const DEFAULT_WIDTH = 320;
const LINE_COLOUR = '#2bb673';

/** Axis top: the max speed rounded up to the next 10 km/h (at least 10). */
export function speedAxisMax(kmh: number[]): number {
  const max = kmh.reduce((m, v) => (v > m ? v : m), 0);
  return Math.max(10, Math.ceil(max / 10) * 10);
}

/** "45 s" / "3 min" / "1 h 5 min" for the time axis. */
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function SpeedStrip({ profile }: { profile: { t: number; kmh: number }[] }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  if (profile.length < 2) {
    return (
      <Paragraph theme="alt2" fontSize="$2">
        Not enough speed readings to draw the speed over time.
      </Paragraph>
    );
  }
  const t0 = profile[0].t;
  const span = Math.max(1, profile[profile.length - 1].t - t0);
  const top = speedAxisMax(profile.map((p) => p.kmh));
  const innerW = Math.max(1, width - 2 * PAD_X);
  const innerH = HEIGHT - 2 * PAD_Y;
  const pts = profile
    .map((p) => {
      const x = PAD_X + ((p.t - t0) / span) * innerW;
      const y = PAD_Y + (1 - Math.min(p.kmh, top) / top) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  return (
    <YStack gap="$1">
      <XStack justifyContent="space-between">
        <Text fontSize="$1" theme="alt2">
          {top} km/h
        </Text>
      </XStack>
      <YStack
        onLayout={onLayout}
        backgroundColor="$color2"
        borderRadius="$3"
        overflow="hidden"
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Speed over time, ${profile.length} points, up to ${top} km/h`}
      >
        <Svg width={width} height={HEIGHT}>
          <Line
            x1={PAD_X}
            y1={HEIGHT - PAD_Y}
            x2={width - PAD_X}
            y2={HEIGHT - PAD_Y}
            stroke="#8b949e"
            strokeWidth={1}
          />
          <Polyline
            testID="speed-strip-line"
            points={pts}
            fill="none"
            stroke={LINE_COLOUR}
            strokeWidth={2}
          />
        </Svg>
      </YStack>
      <XStack justifyContent="space-between">
        <Text fontSize="$1" theme="alt2">
          0 km/h · 0 s
        </Text>
        <Text fontSize="$1" theme="alt2">
          {formatSpan(span)}
        </Text>
      </XStack>
    </YStack>
  );
}
