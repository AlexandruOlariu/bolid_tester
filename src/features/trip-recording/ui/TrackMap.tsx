/** The trip's GPS track drawn with react-native-svg on a plain themed background — no map tiles, no
 *  API key, offline (plan 17). One line per segment coloured by the chosen overlay (speed / RPM /
 *  fuel rate / none), start (green) and end (red) markers, a scale bar, a north arrow and a legend.
 *  Tapping near the track shows the nearest fix's time, speed, RPM and fuel rate. Pure geometry and
 *  colouring live in obd-core `analysis/track.ts`. See docs/features/trip-recording.md. */
import React, { useMemo, useState } from 'react';
import { Pressable, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Button, Card, Paragraph, Text, XStack, YStack } from 'tamagui';
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

const PAD = 16;
/** Map width before the first layout pass (and in tests). */
const DEFAULT_WIDTH = 320;
const START_COLOUR = '#2bb673';
const END_COLOUR = '#f85149';

const CHANNELS: { key: OverlayChannel; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'rpm', label: 'RPM' },
  { key: 'fuelRate', label: 'Fuel' },
  { key: 'none', label: 'None' },
];

/** "+1:05" — elapsed time since the first fix. */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const fmt = (v: number | null, digits: number, unit: string) =>
  v == null ? `— ${unit}` : `${v.toFixed(digits)} ${unit}`;

interface TrackMapProps {
  track: TrackPoint[];
  samples: TripSample[];
}

export function TrackMap({ track, samples }: TrackMapProps) {
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
      <XStack gap="$2" flexWrap="wrap" accessibilityRole="tablist">
        {CHANNELS.map((c) => (
          <Button
            key={c.key}
            size="$2"
            theme={channel === c.key ? 'green' : 'gray'}
            accessibilityRole="tab"
            accessibilityState={{ selected: channel === c.key }}
            onPress={() => setChannel(c.key)}
          >
            {c.label}
          </Button>
        ))}
      </XStack>

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
          accessibilityLabel={`GPS track map, ${track.length} fixes. Tap the track for details.`}
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
              <Circle cx={start.x} cy={start.y} r={6} fill={START_COLOUR} stroke="#ffffff" />
            ) : null}
            {end && points.length > 1 ? (
              <Circle cx={end.x} cy={end.y} r={6} fill={END_COLOUR} stroke="#ffffff" />
            ) : null}
            {selPoint ? (
              <Circle
                cx={selPoint.x}
                cy={selPoint.y}
                r={8}
                fill="none"
                stroke="#ffffff"
                strokeWidth={2}
              />
            ) : null}
            {bar && bar.barPx > 0 ? (
              <Line
                x1={PAD}
                y1={height - 10}
                x2={PAD + bar.barPx}
                y2={height - 10}
                stroke="#8b949e"
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
          accessibilityLabel="North is up"
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
            {new Date(track[sel].t).toLocaleTimeString()} ({elapsed(track[sel].t - track[0].t)})
          </Paragraph>
          <Paragraph>
            {fmt(speed[sel], 0, 'km/h')} · {fmt(rpm[sel], 0, 'rpm')} · {fmt(fuel[sel], 1, 'L/h')}
          </Paragraph>
        </Card>
      ) : (
        <Paragraph theme="alt2" fontSize="$2">
          Tap the track to see the speed, RPM and fuel rate at that point.
        </Paragraph>
      )}
    </YStack>
  );
}
