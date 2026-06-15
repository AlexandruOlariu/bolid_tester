import React from 'react';
import { YStack, XStack, Paragraph, H4, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { tripStats } from '@/shared/obd-core';
import { useTripStore } from '../model/tripStore';
import { useTripRecorder, stopRecording } from '../hooks/useTripRecorder';

export function TripScreen() {
  useTripRecorder();
  const recording = useTripStore((s) => s.recording);
  const start = useTripStore((s) => s.start);
  const samples = useTripStore((s) => s.samples);
  const trips = useTripStore((s) => s.trips);

  return (
    <Screen title="Trips" subtitle="Record live data and export it">
      <XStack gap="$2" alignItems="center">
        <Paragraph flex={1}>{recording ? `Recording… ${samples.length} samples` : 'Not recording'}</Paragraph>
        {recording ? (
          <Button theme="red" onPress={() => void stopRecording()}>
            Stop
          </Button>
        ) : (
          <Button theme="green" onPress={start}>
            Record
          </Button>
        )}
      </XStack>

      <YStack gap="$2">
        <H4>Saved trips</H4>
        {trips.length === 0 ? <Paragraph theme="alt2">No trips yet.</Paragraph> : null}
        {trips.map((t) => {
          const s = tripStats(t);
          return (
            <Paragraph key={t.header.id}>
              {new Date(t.header.startedAt).toLocaleString()} · {(s.durationMs / 1000).toFixed(0)} s ·{' '}
              {s.sampleCount} samples
              {s.distanceKm != null ? ` · ${s.distanceKm.toFixed(2)} km` : ''}
            </Paragraph>
          );
        })}
      </YStack>
    </Screen>
  );
}
