import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen, SegmentedControl, HIT_SLOP } from '@/shared/ui';
import { useGarageStore } from '@/shared/state/garageStore';
import { isUserVehicleId, vehicleLabel } from '@/shared/vehicles';
import { resolveProfile } from '@/shared/vehicles/resolve';
import { tripCarKey, tripCars, UNKNOWN_TRIP_CAR, useTripStore } from '../model/tripStore';
import { useTripRecorder, stopRecording, deleteTrip, shareTrip } from '../hooks/useTripRecorder';
import { startTrackCapture } from '../api/trackRecorder';
import { useTranslation } from '@/shared/i18n';
import { formatDateTime, formatFixed } from '@/shared/lib/format';

export function TripScreen() {
  const { t } = useTranslation('tripRecording');
  useTripRecorder();
  const router = useRouter();
  const recording = useTripStore((s) => s.recording);
  const start = useTripStore((s) => s.start);
  const samples = useTripStore((s) => s.samples);
  const trips = useTripStore((s) => s.trips);
  const garage = useGarageStore((s) => s.vehicles);
  // Per-car filter (plan 06): one chip per car that has trips, plus "All cars".
  const [carKey, setCarKey] = useState<string>('all');
  const cars = useMemo(
    () =>
      tripCars(trips).map((c) => ({
        ...c,
        label:
          c.key === UNKNOWN_TRIP_CAR
            ? t('list.unknownCar')
            : isUserVehicleId(c.key) && !garage.some((v) => v.id === c.key)
              ? t('list.removedCar')
              : vehicleLabel(resolveProfile(c.key, garage)),
      })),
    [trips, garage, t],
  );
  // The chips only show with two or more cars. A filter whose car has no trips left (its last trip
  // was deleted) or that has no chip row any more falls back to "All cars", so the list never
  // sticks on an empty, unclearable filter.
  const activeKey =
    carKey !== 'all' && cars.length > 1 && cars.some((c) => c.key === carKey) ? carKey : 'all';
  // Drop the stale choice too, so the filter does not spring back when that car records again.
  useEffect(() => {
    if (carKey !== activeKey) setCarKey('all');
  }, [carKey, activeKey]);
  const shown = activeKey === 'all' ? trips : trips.filter((t) => tripCarKey(t) === activeKey);

  // Metric only (plan 07 decision): km with two decimals.
  const fmtDistance = (km: number) => `${formatFixed(km, 2)} km`;

  return (
    <Screen title={t('title')} subtitle={t('subtitle')}>
      <XStack gap="$2" alignItems="center">
        <Paragraph flex={1}>
          {recording ? t('recording', { count: samples.length }) : t('notRecording')}
        </Paragraph>
        {recording ? (
          <Button theme="red" onPress={() => void stopRecording()}>
            {t('stop')}
          </Button>
        ) : (
          <Button
            theme="green"
            onPress={() => {
              start();
              // Begin the optional GPS track alongside the OBD samples. Degrades to no track if the
              // module/permission is unavailable — it never blocks recording. See api/trackRecorder.ts.
              void startTrackCapture();
            }}
          >
            {t('record')}
          </Button>
        )}
      </XStack>

      <YStack gap="$2">
        <H4>{t('list.title')}</H4>
        {trips.length === 0 ? <Paragraph theme="alt2">{t('list.empty')}</Paragraph> : null}
        {cars.length > 1 ? (
          <SegmentedControl
            label={t('list.filterA11y')}
            options={[
              { value: 'all', label: t('list.allCars', { count: trips.length }) },
              ...cars.map((c) => ({ value: c.key, label: `${c.label} (${c.count})` })),
            ]}
            value={activeKey}
            onChange={setCarKey}
          />
        ) : null}
        {shown.map(({ header, stats, markerCount }) => (
          <YStack
            key={header.id}
            gap="$2"
            borderColor="$borderColor"
            borderWidth={1}
            borderRadius="$3"
            padding="$2"
          >
            <Paragraph>
              {formatDateTime(header.startedAt)} · {formatFixed(stats.durationMs / 1000, 0)} s ·{' '}
              {t('list.samples', { count: stats.sampleCount })}
              {stats.distanceKm != null ? ` · ${fmtDistance(stats.distanceKm)}` : ''}
              {markerCount > 0 ? ` · ${t('list.markers', { count: markerCount })}` : ''}
            </Paragraph>
            <XStack gap="$2" alignItems="center">
              <Button
                size="$3"
                hitSlop={HIT_SLOP}
                onPress={() => router.push({ pathname: '/trip-detail', params: { id: header.id } })}
              >
                {t('list.open')}
              </Button>
              <Button size="$3" hitSlop={HIT_SLOP} onPress={() => void shareTrip(header)}>
                {t('shareCsv')}
              </Button>
              <Button
                size="$3"
                hitSlop={HIT_SLOP}
                theme="red"
                onPress={() => void deleteTrip(header.id)}
              >
                {t('list.delete')}
              </Button>
            </XStack>
          </YStack>
        ))}
      </YStack>
    </Screen>
  );
}
