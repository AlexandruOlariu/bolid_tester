/** Trip detail (plan 17): one saved trip on its own screen — stats, the GPS-vs-OBD distance check
 *  with a plain verdict, the GPS track map with overlays, and a speed-over-time strip. Opened from
 *  the Trips list (`/trip-detail?id=<trip id>`); samples and track are read once from the trip's CSV
 *  (`loadTrip`). Trips recorded without GPS (no `#TRACK` section) show "No GPS track" plus the stats
 *  that exist. Metric only. See docs/features/trip-recording.md → "Trip detail". */
import React, { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, H4, Paragraph, Spinner, Text, XStack, YStack } from 'tamagui';
import { Screen, ValueCard, HIT_SLOP } from '@/shared/ui';
import { gpsVsObd, speedProfile, type GpsObdCheck } from '@/shared/obd-core';
import { useTripStore } from '../model/tripStore';
import { loadTrip, shareTrip, type LoadedTrip } from '../hooks/useTripRecorder';
import { TrackMap } from './TrackMap';
import { SpeedStrip, formatSpan } from './SpeedStrip';

const VERDICT: Record<GpsObdCheck['verdict'], { label: string; colour: string }> = {
  ok: { label: 'Distances agree', colour: '$statusOk' },
  check: { label: 'Worth a check', colour: '$statusWarn' },
  mismatch: { label: 'Mismatch', colour: '$statusError' },
  unknown: { label: 'Not enough data', colour: '$muted' },
};

const km = (v: number | null | undefined) => (v == null ? null : v.toFixed(2));
const kmh = (v: number) => `${v.toFixed(1)} km/h`;

export function TripDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const summary = useTripStore((s) => s.trips.find((t) => t.header.id === id));
  const header = summary?.header;
  const [loaded, setLoaded] = useState<LoadedTrip | null>(null);

  useEffect(() => {
    setLoaded(null);
    if (!header) return;
    let cancelled = false;
    void loadTrip(header).then((r) => {
      if (!cancelled) setLoaded(r);
    });
    return () => {
      cancelled = true;
    };
  }, [header]);

  const durationMs = summary?.stats.durationMs ?? 0;
  const check = useMemo(
    () => (loaded ? gpsVsObd(loaded.track, loaded.samples, durationMs) : null),
    [loaded, durationMs],
  );
  const profile = useMemo(
    () => (loaded ? speedProfile(loaded.samples, loaded.track) : []),
    [loaded],
  );

  if (!summary || !header) {
    return (
      <Screen title="Trip" subtitle="Saved trip">
        <Paragraph>This trip was not found — it may have been deleted.</Paragraph>
        <Button alignSelf="flex-start" onPress={() => router.push('/trips')}>
          Back to trips
        </Button>
      </Screen>
    );
  }

  const { stats } = summary;
  const track = loaded?.track ?? [];
  const samples = loaded?.samples ?? [];
  // Prefer the freshly loaded data; fall back to the stored summary when the CSV is gone.
  const obdKm = check?.obdKm ?? stats.distanceKm;
  const gpsKm = track.length > 0 ? (check?.gpsKm ?? null) : (stats.gps?.distanceKm ?? null);
  const verdict = check ? VERDICT[check.verdict] : null;

  return (
    <Screen title="Trip" subtitle={new Date(header.startedAt).toLocaleString()}>
      <XStack gap="$2" flexWrap="wrap">
        <ValueCard name="Duration" value={formatSpan(stats.durationMs)} />
        <ValueCard name="Samples" value={String(stats.sampleCount)} />
        <ValueCard name="OBD distance" value={km(obdKm)} unit="km" />
        <ValueCard name="GPS distance" value={km(gpsKm)} unit="km" />
      </XStack>

      {loaded == null ? (
        <XStack gap="$2" alignItems="center">
          <Spinner size="small" />
          <Paragraph theme="alt2">Loading the trip…</Paragraph>
        </XStack>
      ) : (
        <>
          {samples.length === 0 ? (
            <Paragraph theme="alt2">No samples on file for this trip.</Paragraph>
          ) : null}

          {track.length > 0 && check && verdict ? (
            <Card bordered padding="$3" gap="$1" testID="gps-obd-card">
              <H4>GPS vs OBD</H4>
              <Paragraph>
                OBD {check.obdKm != null ? `${check.obdKm.toFixed(2)} km` : '— (no speed reading)'}{' '}
                · GPS {check.gpsKm.toFixed(2)} km
                {check.deltaPct != null
                  ? ` · Δ ${check.deltaPct >= 0 ? '+' : ''}${check.deltaPct.toFixed(1)} %`
                  : ''}
              </Paragraph>
              {check.obdAvgKmh != null && check.gpsAvgKmh != null ? (
                <Paragraph theme="alt2" fontSize="$2">
                  Average speed OBD {kmh(check.obdAvgKmh)} vs GPS {kmh(check.gpsAvgKmh)}
                </Paragraph>
              ) : null}
              <Text color={verdict.colour} fontWeight="800" fontSize="$5">
                {verdict.label}
              </Text>
              <Paragraph fontSize="$3">{check.note}</Paragraph>
            </Card>
          ) : null}

          <YStack gap="$2">
            <XStack gap="$2" alignItems="center">
              <H4 flex={1}>GPS track</H4>
              {summary.syntheticTrack && track.length > 0 ? (
                <Text
                  backgroundColor="$statusWarn"
                  color="$onFill"
                  fontSize="$2"
                  fontWeight="700"
                  paddingHorizontal="$2"
                  paddingVertical="$1"
                  borderRadius="$10"
                >
                  simulated GPS
                </Text>
              ) : null}
            </XStack>
            {track.length >= 2 ? (
              <TrackMap track={track} samples={samples} />
            ) : track.length === 1 ? (
              <Paragraph theme="alt2">Only one GPS fix — not enough to draw a track.</Paragraph>
            ) : (
              <Paragraph theme="alt2">No GPS track for this trip.</Paragraph>
            )}
          </YStack>

          {profile.length > 0 ? (
            <YStack gap="$2">
              <H4>Speed over time</H4>
              <SpeedStrip profile={profile} />
            </YStack>
          ) : null}
        </>
      )}

      <XStack gap="$2">
        <Button size="$3" hitSlop={HIT_SLOP} onPress={() => void shareTrip(header)}>
          Share CSV
        </Button>
        <Button size="$3" hitSlop={HIT_SLOP} onPress={() => router.push('/trips')}>
          All trips
        </Button>
      </XStack>
    </Screen>
  );
}
