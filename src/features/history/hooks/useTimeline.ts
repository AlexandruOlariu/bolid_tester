import { useMemo } from 'react';
import {
  useHistoryStore,
  type HistoryEntry,
  type HistoryVehicle,
} from '@/shared/state/historyStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { isUserVehicleId, vehicleLabel, type UserVehicle } from '@/shared/vehicles';
import { resolveProfile } from '@/shared/vehicles/resolve';
import { mergeTimeline, type TimelineItem } from '@/shared/lib/timeline';
import { useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import { UNKNOWN_TRIP_CAR, useTripStore } from '@/features/trip-recording/model/tripStore';
import {
  LEGACY_PENDING_KEY,
  useMaintenanceStore,
} from '@/features/maintenance/model/maintenanceStore';
import { useCarBackupStore } from '@/features/coding/model/carBackupStore';
import {
  fromBackups,
  fromHistory,
  fromMaintenance,
  fromScans,
  fromTrips,
} from '../api/timelineSources';
import { translate, useTranslation } from '@/shared/i18n';

/** Display name of a car by its registry / garage id (the Trips screen's rule). */
export function carLabel(carId: string, garage: UserVehicle[]): string {
  if (carId === UNKNOWN_TRIP_CAR) return translate('tripRecording:list.unknownCar');
  if (isUserVehicleId(carId) && !garage.some((v) => v.id === carId))
    return translate('tripRecording:list.removedCar');
  return vehicleLabel(resolveProfile(carId, garage));
}

/** The car behind a maintenance bucket key (`id:<profile id>` or `vin:<VIN>`, see
 *  `maintenanceKeysFor`), or null for the parked v1 logbook that has no car yet. */
export function maintenanceVehicle(key: string, garage: UserVehicle[]): HistoryVehicle | null {
  if (key === LEGACY_PENDING_KEY) return null;
  if (key.startsWith('vin:')) {
    const vin = key.slice(4);
    const owner = garage.find((v) => v.learned?.vin === vin);
    return owner
      ? { id: owner.id, label: carLabel(owner.id, garage), vin }
      : { id: key, label: translate('tripRecording:list.unknownCar'), vin };
  }
  const id = key.startsWith('id:') ? key.slice(3) : key;
  return { id, label: carLabel(id, garage), vin: null };
}

/** Every timeline item across the seven sources, newest first (unfiltered — the screen filters),
 *  plus the history entries by id for the renderers that need the full record (AI report sheet,
 *  report re-share, the fault-code export). See docs/features/history.md. */
export function useTimeline(): {
  items: TimelineItem[];
  entriesById: Map<string, HistoryEntry>;
  historyCount: number;
} {
  const entries = useHistoryStore((s) => s.entries);
  const scans = useScanHistoryStore((s) => s.scans);
  const trips = useTripStore((s) => s.trips);
  const byVehicle = useMaintenanceStore((s) => s.byVehicle);
  const serviceItems = useMaintenanceStore((s) => s.items);
  const backups = useCarBackupStore((s) => s.backups);
  const garage = useGarageStore((s) => s.vehicles);
  // The item titles / subtitles are built with `translate` and `formatFixed`, so the list is rebuilt
  // when the language changes — History stays mounted once visited (plan 11).
  const { i18n } = useTranslation();
  const language = i18n.language;

  const items = useMemo(() => {
    const maintenance = Object.entries(byVehicle).flatMap(([key, bucket]) => {
      const vehicle = maintenanceVehicle(key, garage);
      return vehicle ? fromMaintenance(bucket.entries, serviceItems, vehicle) : [];
    });
    return mergeTimeline([
      fromHistory(entries),
      fromScans(scans),
      fromTrips(trips, (carId) => carLabel(carId, garage)),
      maintenance,
      fromBackups(backups),
    ]);
    // `language`: not read inside, but every string above depends on it (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, scans, trips, byVehicle, serviceItems, backups, garage, language]);

  const entriesById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  return { items, entriesById, historyCount: entries.length };
}
