/** Trip recording — feature-layer lifecycle. Sample accumulation while recording is owned app-wide
 *  by EngineHost, so a trip records fully even when the Trip screen isn't mounted. This module owns
 *  the CSV file lifecycle for a finished trip: write on stop, lazy-load on open, delete on remove,
 *  and share/export. Native modules (expo-file-system / expo-sharing) are loaded via variable
 *  specifiers so the project builds and unit-tests without them present — the same
 *  dependency-tolerant pattern as useDtcExport / useErrorLogExport. See docs/features/trip-recording.md. */
import { Trip, TripHeader, TripSample, toCsv, fromCsv, tripStats } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { logError } from '@/shared/state/errorLogStore';
import { notify } from '@/shared/notify';
import { useTripStore } from '../model/tripStore';
import { stopTrackCapture } from '../api/trackRecorder';

/** Per-trip CSV filename stem (documentDirectory-relative). */
function tripCsvName(id: string): string {
  return `trip-${id}.csv`;
}

/** Kept as a no-op so TripScreen's public API stays stable; the real work is in EngineHost. */
export function useTripRecorder(): void {
  // Intentionally empty — see EngineHost.
}

/** Build, persist (CSV via expo-file-system), and record the summary of a finished trip. */
export async function stopRecording(): Promise<Trip> {
  const st = useTripStore.getState();
  const info = useSessionStore.getState().info;
  const profileId = useVehicleStore.getState().selectedProfileId;
  // Stop the (optional) GPS capture and attach its track before serialising, so it round-trips through
  // the CSV and feeds `tripStats` (GPS distance / OBD-vs-GPS speed delta). An empty track — capture was
  // never started, denied, or unavailable — is simply omitted, leaving the trip shape unchanged.
  const track = stopTrackCapture();
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
    ...(track.length > 0 ? { track } : {}),
  };
  try {
    const FileSystem = await import('expo-file-system' as string);
    const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
    if (dir) await FileSystem.writeAsStringAsync(`${dir}${tripCsvName(trip.header.id)}`, toCsv(trip));
  } catch (e) {
    // file system unavailable — record why the CSV didn't save. The summary still persists below,
    // but opening the trip later will find no samples.
    logError({
      source: 'trip-recording',
      error: e,
      severity: 'warning',
      context: { phase: 'csv-write', tripId: trip.header.id },
    });
  }
  const stats = tripStats(trip);
  useTripStore.getState().finish({ header: trip.header, stats, markerCount: trip.markers.length });
  void notify({
    category: 'trip',
    severity: 'info',
    title: 'Trip recorded',
    body: `${(stats.durationMs / 1000).toFixed(0)} s, ${stats.sampleCount} samples`,
  });
  return trip;
}

/** Lazy-load a trip's samples from its CSV. Returns `[]` when the file is missing/unreadable (e.g.
 *  the CSV write failed on stop, or on web/tests) — best-effort, logged. */
export async function loadTripSamples(header: TripHeader): Promise<TripSample[]> {
  try {
    const FileSystem = await import('expo-file-system' as string);
    const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
    if (!dir) return [];
    const uri = `${dir}${tripCsvName(header.id)}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return [];
    return fromCsv(await FileSystem.readAsStringAsync(uri));
  } catch (e) {
    logError({ source: 'trip-recording', error: e, severity: 'warning', context: { phase: 'csv-read', tripId: header.id } });
    return [];
  }
}

/** Remove a trip: delete its CSV (idempotent, best-effort) then drop the summary from the store. */
export async function deleteTrip(id: string): Promise<void> {
  try {
    const FileSystem = await import('expo-file-system' as string);
    const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
    if (dir) await FileSystem.deleteAsync(`${dir}${tripCsvName(id)}`, { idempotent: true });
  } catch (e) {
    // Orphaning a CSV is not fatal — log and still remove the list entry.
    logError({ source: 'trip-recording', error: e, severity: 'warning', context: { phase: 'csv-delete', tripId: id } });
  }
  useTripStore.getState().removeTrip(id);
}

/** Open the OS share sheet for a trip's CSV (expo-sharing). Returns the file URI on success, or null
 *  when the file or sharing is unavailable (web/tests). */
export async function shareTrip(header: TripHeader): Promise<string | null> {
  try {
    const FileSystem = await import('expo-file-system' as string);
    const Sharing = await import('expo-sharing' as string);
    const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
    if (!dir) return null;
    const uri = `${dir}${tripCsvName(header.id)}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export trip' });
    }
    return uri;
  } catch (e) {
    logError({ source: 'trip-recording/share', error: e, severity: 'warning', context: { tripId: header.id } });
    return null;
  }
}
