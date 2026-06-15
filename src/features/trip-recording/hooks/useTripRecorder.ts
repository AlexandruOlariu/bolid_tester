import { useEffect } from 'react';
import { Trip, toCsv, tripStats } from '@/shared/obd-core';
import { useLiveDataStore } from '@/features/live-data/model/liveDataStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { notify } from '@/shared/notify';
import { useTripStore } from '../model/tripStore';

/** Accumulate live snapshots into the current trip while recording. */
export function useTripRecorder() {
  const values = useLiveDataStore((s) => s.values);
  const recording = useTripStore((s) => s.recording);
  const pushSample = useTripStore((s) => s.pushSample);

  useEffect(() => {
    if (!recording) return;
    const numeric: Record<string, number | null> = {};
    for (const [pid, v] of Object.entries(values)) numeric[pid] = v?.value ?? null;
    pushSample({ t: Date.now(), values: numeric });
  }, [values, recording, pushSample]);
}

/** Build, persist (CSV via expo-file-system), and store a finished trip. */
export async function stopRecording(): Promise<Trip> {
  const st = useTripStore.getState();
  const info = useSessionStore.getState().info;
  const profileId = useVehicleStore.getState().selectedProfileId;
  const trip: Trip = {
    header: {
      id: `${st.startedAt ?? Date.now()}`,
      startedAt: st.startedAt ?? Date.now(),
      endedAt: Date.now(),
      profileId,
      vin: info?.vin ?? null,
      protocol: info?.protocol ?? 'UNKNOWN',
    },
    samples: st.samples,
    markers: st.markers,
  };
  try {
    const FileSystem = await import('expo-file-system' as string);
    const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
    await FileSystem.writeAsStringAsync(`${dir}trip-${trip.header.id}.csv`, toCsv(trip));
  } catch {
    // file system unavailable — the trip still lives in memory.
  }
  useTripStore.getState().finish(trip);
  const stats = tripStats(trip);
  void notify({
    category: 'trip',
    severity: 'info',
    title: 'Trip recorded',
    body: `${(stats.durationMs / 1000).toFixed(0)} s, ${stats.sampleCount} samples`,
  });
  return trip;
}
