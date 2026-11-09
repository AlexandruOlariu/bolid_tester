import { useCallback, useMemo } from 'react';
import { computeDue, DueInfo, LogEntry } from '@/shared/obd-core';
import { useGarageStore } from '@/shared/state/garageStore';
import { vehicleLabel } from '@/shared/vehicles';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { bucketFor, maintenanceKeysFor, useMaintenanceStore } from '../model/maintenanceStore';

const ORDER: Record<DueInfo['status'], number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 };

/** The active car's logbook + the computed "what's due" list (worst-first). Every car keeps its own
 *  logbook (plan 06); switching the active car switches the logbook. */
export function useMaintenance() {
  const profile = useActiveProfile();
  const vehicles = useGarageStore((s) => s.vehicles);
  const keys = useMemo(() => maintenanceKeysFor(profile.id, vehicles), [profile.id, vehicles]);
  const items = useMaintenanceStore((s) => s.items);
  const byVehicle = useMaintenanceStore((s) => s.byVehicle);
  const bucket = bucketFor(byVehicle, keys);
  const { entries, odoKm, kmPerYear } = bucket;

  const setOdometerFor = useMaintenanceStore((s) => s.setOdometer);
  const addEntryFor = useMaintenanceStore((s) => s.addEntry);
  const removeEntryFor = useMaintenanceStore((s) => s.removeEntry);
  const setOdometer = useCallback(
    (v: number | null) => setOdometerFor(keys, v),
    [setOdometerFor, keys],
  );
  const addEntry = useCallback(
    (e: Omit<LogEntry, 'id'>) => addEntryFor(keys, e),
    [addEntryFor, keys],
  );
  const removeEntry = useCallback((id: string) => removeEntryFor(keys, id), [removeEntryFor, keys]);

  const due = useMemo(
    () => computeDue(items, entries, { odoKm }).sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    [items, entries, odoKm],
  );

  return {
    /** Primary bucket key of the active car — changes when the car does. */
    vehicleKey: keys[0],
    vehicleLabel: vehicleLabel(profile),
    items,
    entries,
    odoKm,
    kmPerYear,
    due,
    setOdometer,
    addEntry,
    removeEntry,
  };
}
