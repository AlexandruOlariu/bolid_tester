import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useGarageStore } from '@/shared/state/garageStore';
import { isUserVehicleId, vehicleLabel } from '@/shared/vehicles';
import { resolveProfile } from '@/shared/vehicles/resolve';
import { tripCarKey, tripCars, UNKNOWN_TRIP_CAR, useTripStore } from '../model/tripStore';
import { useTripRecorder, stopRecording, deleteTrip, shareTrip } from '../hooks/useTripRecorder';
import { startTrackCapture } from '../api/trackRecorder';

export function TripScreen() {
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
            ? 'Unknown car'
            : isUserVehicleId(c.key) && !garage.some((v) => v.id === c.key)
              ? 'Removed car'
              : vehicleLabel(resolveProfile(c.key, garage)),
      })),
    [trips, garage],
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
  const fmtDistance = (km: number) => `${km.toFixed(2)} km`;

  return (
    <Screen title="Trips" subtitle="Record live data and export it">
      <XStack gap="$2" alignItems="center">
        <Paragraph flex={1}>
          {recording ? `Recording… ${samples.length} samples` : 'Not recording'}
        </Paragraph>
        {recording ? (
          <Button theme="red" onPress={() => void stopRecording()}>
            Stop
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
            Record
          </Button>
        )}
      </XStack>

      <YStack gap="$2">
        <H4>Saved trips</H4>
        {trips.length === 0 ? <Paragraph theme="alt2">No trips yet.</Paragraph> : null}
        {cars.length > 1 ? (
          <XStack gap="$2" flexWrap="wrap">
            <Button
              size="$2"
              theme={activeKey === 'all' ? 'green' : 'gray'}
              onPress={() => setCarKey('all')}
            >
              {`All cars (${trips.length})`}
            </Button>
            {cars.map((c) => (
              <Button
                key={c.key}
                size="$2"
                theme={activeKey === c.key ? 'green' : 'gray'}
                onPress={() => setCarKey(c.key)}
              >
                {`${c.label} (${c.count})`}
              </Button>
            ))}
          </XStack>
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
              {new Date(header.startedAt).toLocaleString()} · {(stats.durationMs / 1000).toFixed(0)}{' '}
              s · {stats.sampleCount} samples
              {stats.distanceKm != null ? ` · ${fmtDistance(stats.distanceKm)}` : ''}
              {markerCount > 0 ? ` · ${markerCount} marker${markerCount === 1 ? '' : 's'}` : ''}
            </Paragraph>
            <XStack gap="$2" alignItems="center">
              <Button
                size="$2"
                onPress={() => router.push({ pathname: '/trip-detail', params: { id: header.id } })}
              >
                Open
              </Button>
              <Button size="$2" onPress={() => void shareTrip(header)}>
                Share CSV
              </Button>
              <Button size="$2" theme="red" onPress={() => void deleteTrip(header.id)}>
                Delete
              </Button>
            </XStack>
          </YStack>
        ))}
      </YStack>
    </Screen>
  );
}
