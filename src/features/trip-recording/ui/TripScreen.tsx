import React, { useState } from 'react';
import { YStack, XStack, Paragraph, H4, Button, Spinner } from 'tamagui';
import { Screen } from '@/shared/ui';
import type { TripSample } from '@/shared/obd-core';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { convert } from '@/shared/lib/units';
import { useTripStore } from '../model/tripStore';
import { useTripRecorder, stopRecording, loadTripSamples, deleteTrip, shareTrip } from '../hooks/useTripRecorder';
import { startTrackCapture } from '../api/trackRecorder';

export function TripScreen() {
  useTripRecorder();
  const recording = useTripStore((s) => s.recording);
  const start = useTripStore((s) => s.start);
  const samples = useTripStore((s) => s.samples);
  const trips = useTripStore((s) => s.trips);
  const units = useSettingsStore((s) => s.units);

  // Display-time unit conversion: obd-core keeps canonical metric (km, km/h); we only relabel/convert
  // when rendering, per the user's units setting. See shared/lib/units.ts.
  const fmtDistance = (km: number) => {
    const m = convert(km, 'km', units);
    return `${(m.value ?? km).toFixed(2)} ${m.unit}`;
  };
  const fmtSpeed = (kmh: number) => {
    const m = convert(kmh, 'km/h', units);
    return `${(m.value ?? kmh).toFixed(1)} ${m.unit}`;
  };

  // The opened trip's samples are lazy-loaded from its CSV on demand (they are not held in the store).
  const [openId, setOpenId] = useState<string | null>(null);
  const [openSamples, setOpenSamples] = useState<TripSample[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const open = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setOpenSamples(null);
      return;
    }
    const summary = trips.find((t) => t.header.id === id);
    if (!summary) return;
    setLoadingId(id);
    const loaded = await loadTripSamples(summary.header);
    setLoadingId(null);
    setOpenId(id);
    setOpenSamples(loaded);
  };

  const remove = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setOpenSamples(null);
    }
    await deleteTrip(id);
  };

  return (
    <Screen title="Trips" subtitle="Record live data and export it">
      <XStack gap="$2" alignItems="center">
        <Paragraph flex={1}>{recording ? `Recording… ${samples.length} samples` : 'Not recording'}</Paragraph>
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
        {trips.map(({ header, stats, markerCount }) => (
          <YStack key={header.id} gap="$2" borderColor="$borderColor" borderWidth={1} borderRadius="$3" padding="$2">
            <Paragraph>
              {new Date(header.startedAt).toLocaleString()} · {(stats.durationMs / 1000).toFixed(0)} s ·{' '}
              {stats.sampleCount} samples
              {stats.distanceKm != null ? ` · ${fmtDistance(stats.distanceKm)}` : ''}
              {markerCount > 0 ? ` · ${markerCount} marker${markerCount === 1 ? '' : 's'}` : ''}
            </Paragraph>
            <XStack gap="$2" alignItems="center">
              <Button size="$2" onPress={() => void open(header.id)} disabled={loadingId === header.id}>
                {openId === header.id ? 'Close' : 'Open'}
              </Button>
              <Button size="$2" onPress={() => void shareTrip(header)}>
                Share CSV
              </Button>
              <Button size="$2" theme="red" onPress={() => void remove(header.id)}>
                Delete
              </Button>
              {loadingId === header.id ? <Spinner size="small" /> : null}
            </XStack>
            {openId === header.id && openSamples != null ? (
              <YStack gap="$1">
                <Paragraph theme="alt2" fontSize="$2">
                  {openSamples.length === 0
                    ? 'No samples on file for this trip.'
                    : `Loaded ${openSamples.length} sample${openSamples.length === 1 ? '' : 's'} from CSV.`}
                </Paragraph>
                {stats.gps ? (
                  <>
                    <Paragraph theme="alt2" fontSize="$2">
                      GPS distance {fmtDistance(stats.gps.distanceKm)} · {stats.gps.points} fix
                      {stats.gps.points === 1 ? '' : 'es'}
                    </Paragraph>
                    {stats.gps.obdAvgSpeedKmh != null && stats.gps.avgSpeedKmh != null ? (
                      <Paragraph theme="alt2" fontSize="$2">
                        Avg speed OBD {fmtSpeed(stats.gps.obdAvgSpeedKmh)} vs GPS{' '}
                        {fmtSpeed(stats.gps.avgSpeedKmh)}
                        {stats.gps.speedDeltaKmh != null ? ` (Δ ${fmtSpeed(stats.gps.speedDeltaKmh)})` : ''}
                      </Paragraph>
                    ) : null}
                  </>
                ) : null}
              </YStack>
            ) : null}
          </YStack>
        ))}
      </YStack>
    </Screen>
  );
}
