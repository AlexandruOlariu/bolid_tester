/** The trip's GPS track drawn with react-native-svg on a plain themed background — no map tiles, no
 *  API key, offline (plan 17). One line per segment coloured by the chosen overlay (speed / RPM /
 *  fuel rate / none), start (green) and end (red) markers, a scale bar, a north arrow and a legend.
 *  Tapping near the track shows the nearest fix's time, speed, RPM and fuel rate. Pure geometry and
 *  colouring live in obd-core `analysis/track.ts`. See docs/features/trip-recording.md. */
import React, { useMemo, useState } from 'react';
import { Pressable, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Card, Paragraph, Text, XStack, YStack } from 'tamagui';
import { SegmentedControl, usePalette } from '@/shared/ui';
import {
  alignSamplesToTrack,
  colourSegments,
  formatBarLength,
  legendFor,
  nearestPoint,
  projectTrack,
  scaleBar,
  trackBounds,
  type OverlayChannel,
  type TrackPoint,
  type TripSample,
} from '@/shared/obd-core';
import { useTranslation, type TFunction } from '@/shared/i18n';
import { formatFixed, formatTime } from '@/shared/lib/format';

const PAD = 16;
/** Map width before the first layout pass (and in tests). */
const DEFAULT_WIDTH = 320;

const channels = (
  t: TFunction,
): { value: OverlayChannel; label: string; accessibilityLabel?: string }[] => [
  { value: 'speed', label: t('map.speed') },
  { value: 'rpm', label: t('map.rpm') },
  { value: 'fuelRate', label: t('map.fuel'), accessibilityLabel: t('map.fuelA11y') },
  { value: 'none', label: t('map.none'), accessibilityLabel: t('map.noneA11y') },
];

/** "+1:05" — elapsed time since the first fix. */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const fmt = (v: number | null, digits: number, unit: string) =>
  v == null ? `— ${unit}` : `${formatFixed(v, digits)} ${unit}`;

interface TrackMapProps {
  track: TrackPoint[];
  samples: TripSample[];
}

export function TrackMap({ track, samples }: TrackMapProps) {
  const { t } = useTranslation('tripRecording');
  const palette = usePalette();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const height = Math.round((width * 2) / 3);
  const [channel, setChannel] = useState<OverlayChannel>('speed');
  const [selected, setSelected] = useState<number | null>(null);

  const bounds = useMemo(() => trackBounds(track), [track]);
  const points = useMemo(() => projectTrack(track, width, height, PAD), [track, width, height]);
  // The tooltip shows every channel, whatever the overlay.
  const speed = useMemo(() => alignSamplesToTrack(track, samples, 'speed'), [track, samples]);
  const rpm = useMemo(() => alignSamplesToTrack(track, samples, 'rpm'), [track, samples]);
  const fuel = useMemo(() => alignSamplesToTrack(track, samples, 'fuelRate'), [track, samples]);
  const values = useMemo(
    () =>
      channel === 'speed'
        ? speed
        : channel === 'rpm'
          ? rpm
          : channel === 'fuelRate'
            ? fuel
            : track.map(() => null),
    [channel, speed, rpm, fuel, track],
  );
  const segments = useMemo(
    () => colourSegments(points, values, channel),
    [points, values, channel],
  );
  const legend = useMemo(() => legendFor(channel, values), [channel, values]);
  const bar = bounds ? scaleBar(bounds, width, PAD, height) : null;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };
  const onPress = (e: GestureResponderEvent) => {
    const hit = nearestPoint(points, e.nativeEvent.locationX, e.nativeEvent.locationY);
    setSelected(hit ? hit.i : null);
  };

  const start = points[0];
  const end = points[points.length - 1];
  const sel = selected != null && selected < track.length ? selected : null;
  const selPoint = sel != null ? points[sel] : null;

  return (
    <YStack gap="$2">
      <SegmentedControl
        label={t('map.colourBy')}
        options={channels(t)}
        value={channel}
        onChange={setChannel}
      />

      <YStack
        onLayout={onLayout}
        backgroundColor="$color2"
        borderRadius="$3"
        overflow="hidden"
        position="relative"
      >
        <Pressable
          testID="track-map"
          onPress={onPress}
          accessibilityRole="image"
          accessibilityLabel={t('map.a11y', { count: track.length })}
        >
          <Svg width={width} height={height}>
            {segments.map((s, k) => (
              <Line
                key={k}
                testID="track-segment"
                x1={s.from.x}
                y1={s.from.y}
                x2={s.to.x}
                y2={s.to.y}
                stroke={s.colour}
                strokeWidth={4}
                strokeLinecap="round"
              />
            ))}
            {start ? (
              <Circle
                cx={start.x}
                cy={start.y}
                r={6}
                fill={palette.statusOk}
                stroke={palette.background}
              />
            ) : null}
            {end && points.length > 1 ? (
              <Circle
                cx={end.x}
                cy={end.y}
                r={6}
                fill={palette.statusError}
                stroke={palette.background}
              />
            ) : null}
            {selPoint ? (
              <Circle
                cx={selPoint.x}
                cy={selPoint.y}
                r={8}
                fill="none"
                stroke={palette.color}
                strokeWidth={2}
              />
            ) : null}
            {bar && bar.barPx > 0 ? (
              <Line
                x1={PAD}
                y1={height - 10}
                x2={PAD + bar.barPx}
                y2={height - 10}
                stroke={palette.muted}
                strokeWidth={3}
              />
            ) : null}
          </Svg>
        </Pressable>
        <Text
          position="absolute"
          top={6}
          right={10}
          fontSize="$3"
          fontWeight="800"
          theme="alt2"
          pointerEvents="none"
          accessibilityLabel={t('map.north')}
        >
          N ↑
        </Text>
        {bar && bar.barPx > 0 ? (
          <Text
            position="absolute"
            left={PAD}
            bottom={14}
            fontSize="$1"
            theme="alt2"
            pointerEvents="none"
          >
            {formatBarLength(bar.barMetres)}
          </Text>
        ) : null}
      </YStack>

      {legend.length > 0 ? (
        <XStack gap="$3" flexWrap="wrap" testID="track-legend">
          {legend.map((l, k) => (
            <XStack key={`${k}-${l.label}`} gap="$1.5" alignItems="center">
              <YStack width={12} height={12} borderRadius={6} backgroundColor={l.colour} />
              <Text fontSize="$2">{l.label}</Text>
            </XStack>
          ))}
        </XStack>
      ) : null}

      {sel != null ? (
        <Card bordered padding="$2.5" testID="track-tooltip">
          <Paragraph fontWeight="700">
            {formatTime(track[sel].t, true)} ({elapsed(track[sel].t - track[0].t)})
          </Paragraph>
          <Paragraph>
            {fmt(speed[sel], 0, 'km/h')} · {fmt(rpm[sel], 0, 'rpm')} · {fmt(fuel[sel], 1, 'L/h')}
          </Paragraph>
        </Card>
      ) : (
        <Paragraph theme="alt2" fontSize="$2">
          {t('map.tapHint')}
        </Paragraph>
      )}
    </YStack>
  );
}
