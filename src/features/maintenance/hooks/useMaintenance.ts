import { useMemo } from 'react';
import { computeDue, DueInfo } from '@/shared/obd-core';
import { useMaintenanceStore } from '../model/maintenanceStore';

const ORDER: Record<DueInfo['status'], number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 };

/** Logbook data + the computed "what's due" list (worst-first). */
export function useMaintenance() {
  const items = useMaintenanceStore((s) => s.items);
  const entries = useMaintenanceStore((s) => s.entries);
  const odoKm = useMaintenanceStore((s) => s.odoKm);
  const kmPerYear = useMaintenanceStore((s) => s.kmPerYear);
  const setOdometer = useMaintenanceStore((s) => s.setOdometer);
  const addEntry = useMaintenanceStore((s) => s.addEntry);
  const removeEntry = useMaintenanceStore((s) => s.removeEntry);

  const due = useMemo(
    () => computeDue(items, entries, { odoKm }).sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    [items, entries, odoKm],
  );

  return { items, entries, odoKm, kmPerYear, due, setOdometer, addEntry, removeEntry };
}
