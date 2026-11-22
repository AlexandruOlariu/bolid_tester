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
import { useTranslation } from '@/shared/i18n';
import { formatDateTime, formatFixed } from '@/shared/lib/format';

/** Verdict colours; labels are `tripRecording:detail.verdict.<verdict>` (plan 11). */
const VERDICT: Record<GpsObdCheck['verdict'], { colour: string }> = {
  ok: { colour: '$statusOk' },
  check: { colour: '$statusWarn' },
  mismatch: { colour: '$statusError' },
  unknown: { colour: '$muted' },
};

const km = (v: number | null | undefined) => (v == null ? null : formatFixed(v, 2));
const kmh = (v: number) => `${formatFixed(v, 1)} km/h`;

export function TripDetailScreen() {
  const { t } = useTranslation('tripRecording');
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
      <Screen title={t('detail.title')} subtitle={t('detail.saved')}>
        <Paragraph>{t('detail.notFound')}</Paragraph>
        <Button alignSelf="flex-start" onPress={() => router.push('/trips')}>
          {t('detail.back')}
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
    <Screen title={t('detail.title')} subtitle={formatDateTime(header.startedAt)}>
      <XStack gap="$2" flexWrap="wrap">
        <ValueCard name={t('detail.duration')} value={formatSpan(stats.durationMs)} />
        <ValueCard name={t('detail.samples')} value={String(stats.sampleCount)} />
        <ValueCard name={t('detail.obdDistance')} value={km(obdKm)} unit="km" />
        <ValueCard name={t('detail.gpsDistance')} value={km(gpsKm)} unit="km" />
      </XStack>

      {loaded == null ? (
        <XStack gap="$2" alignItems="center">
          <Spinner size="small" />
          <Paragraph theme="alt2">{t('detail.loading')}</Paragraph>
        </XStack>
      ) : (
        <>
          {samples.length === 0 ? (
            <Paragraph theme="alt2">{t('detail.noSamples')}</Paragraph>
          ) : null}

          {track.length > 0 && check && verdict ? (
            <Card bordered padding="$3" gap="$1" testID="gps-obd-card">
              <H4>{t('detail.gpsVsObd')}</H4>
              <Paragraph>
                OBD{' '}
                {check.obdKm != null
                  ? `${formatFixed(check.obdKm, 2)} km`
                  : t('detail.noSpeedReading')}{' '}
                · GPS {formatFixed(check.gpsKm, 2)} km
                {check.deltaPct != null
                  ? ` · Δ ${check.deltaPct >= 0 ? '+' : ''}${formatFixed(check.deltaPct, 1)} %`
                  : ''}
              </Paragraph>
              {check.obdAvgKmh != null && check.gpsAvgKmh != null ? (
                <Paragraph theme="alt2" fontSize="$2">
                  {t('detail.avgSpeed', { obd: kmh(check.obdAvgKmh), gps: kmh(check.gpsAvgKmh) })}
                </Paragraph>
              ) : null}
              <Text color={verdict.colour} fontWeight="800" fontSize="$5">
                {t(`detail.verdict.${check.verdict}`)}
              </Text>
              <Paragraph fontSize="$3">{check.note}</Paragraph>
            </Card>
          ) : null}

          <YStack gap="$2">
            <XStack gap="$2" alignItems="center">
              <H4 flex={1}>{t('detail.gpsTrack')}</H4>
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
                  {t('detail.simulatedGps')}
                </Text>
              ) : null}
            </XStack>
            {track.length >= 2 ? (
              <TrackMap track={track} samples={samples} />
            ) : track.length === 1 ? (
              <Paragraph theme="alt2">{t('detail.oneFix')}</Paragraph>
            ) : (
              <Paragraph theme="alt2">{t('detail.noTrack')}</Paragraph>
            )}
          </YStack>

          {profile.length > 0 ? (
            <YStack gap="$2">
              <H4>{t('detail.speedOverTime')}</H4>
              <SpeedStrip profile={profile} />
            </YStack>
          ) : null}
        </>
      )}

      <XStack gap="$2">
        <Button size="$3" hitSlop={HIT_SLOP} onPress={() => void shareTrip(header)}>
          {t('shareCsv')}
        </Button>
        <Button size="$3" hitSlop={HIT_SLOP} onPress={() => router.push('/trips')}>
          {t('detail.allTrips')}
        </Button>
      </XStack>
    </Screen>
  );
}
