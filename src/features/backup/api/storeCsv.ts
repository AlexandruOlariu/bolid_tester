/** CSV exports of the tabular stores (plan 18): diagnostic history (one row per fault code of each
 *  fault-code check), saved module scans (one row per module fault) and the maintenance logbook (one
 *  row per entry). Pure: each takes the store's persisted state as `unknown` (what the file holds)
 *  and tolerates a malformed one. Dates are ISO 8601 UTC, distances in km — metric only. */
import { DEFAULT_SERVICE_ITEMS } from '@/shared/obd-core';
import type { HistoryEntry } from '@/shared/state/historyStore';
import type { SavedScan } from '@/features/module-scan/model/scanHistoryStore';
import type { MaintenanceBucket } from '@/features/maintenance/model/maintenanceStore';

/** RFC 4180 cell: quoted when it holds a comma, quote or line break; quotes doubled. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRows(
  header: string[],
  rows: (string | number | boolean | null | undefined)[][],
) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function iso(ts: unknown): string {
  return typeof ts === 'number' && Number.isFinite(ts) ? new Date(ts).toISOString() : '';
}

function listOf<T>(state: unknown, key: string): T[] {
  const v = (state as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

export const HISTORY_CSV_HEADER = [
  'date_utc',
  'vehicle',
  'vin',
  'mil_on',
  'list',
  'code',
  'description',
];

/** One row per code of every fault-code check (`kind: 'dtc'`); a check that found nothing still
 *  gets one row with an empty code, so "clean on that date" is in the file too. */
export function historyCsv(state: unknown): string {
  const rows: (string | number | boolean | null)[][] = [];
  for (const e of listOf<HistoryEntry>(state, 'entries')) {
    if (!e || e.kind !== 'dtc') continue;
    const base = [iso(e.ts), e.vehicle?.label ?? '', e.vehicle?.vin ?? '', e.milOn];
    const lists: ['stored' | 'pending' | 'permanent', { code: string; description: string }[]][] = [
      ['stored', e.stored ?? []],
      ['pending', e.pending ?? []],
      ['permanent', e.permanent ?? []],
    ];
    let any = false;
    for (const [list, codes] of lists) {
      for (const d of codes) {
        any = true;
        rows.push([...base, list, d.code, d.description]);
      }
    }
    if (!any) rows.push([...base, '', '', 'No fault codes']);
  }
  return csvRows(HISTORY_CSV_HEADER, rows);
}

export const SCANS_CSV_HEADER = [
  'date_utc',
  'vehicle',
  'vin',
  'scan_id',
  'module_address',
  'module_name',
  'code',
  'vag_code',
  'description',
  'status_hex',
];

const hex2 = (n: unknown) =>
  typeof n === 'number' ? n.toString(16).toUpperCase().padStart(2, '0') : '';

/** One row per module fault of every saved scan — UDS modules and pre-UDS (TP2.0) modules alike. */
export function scansCsv(state: unknown): string {
  const rows: (string | number | null)[][] = [];
  for (const scan of listOf<SavedScan>(state, 'scans')) {
    if (!scan) continue;
    const base = [iso(scan.ts), scan.vehicle?.label ?? '', scan.vehicle?.vin ?? '', scan.id];
    for (const m of scan.modules ?? []) {
      for (const d of m.dtcs ?? []) {
        rows.push([
          ...base,
          m.address,
          m.name,
          d.display,
          d.vagCode,
          d.description,
          hex2(d.status),
        ]);
      }
    }
    for (const m of scan.tp20?.modules ?? []) {
      for (const d of m.dtcs ?? []) {
        rows.push([...base, hex2(m.address), m.name, '', d.vag, '', hex2(d.status)]);
      }
    }
  }
  return csvRows(SCANS_CSV_HEADER, rows);
}

export const MAINTENANCE_CSV_HEADER = ['car', 'date_utc', 'item', 'odometer_km', 'note'];

/** One row per logbook entry, newest first within each car (keyed `vin:<VIN>` / `id:<profile>`). */
export function maintenanceCsv(state: unknown): string {
  const byVehicle = (state as { byVehicle?: unknown } | null)?.byVehicle;
  const buckets =
    byVehicle && typeof byVehicle === 'object'
      ? (byVehicle as Record<string, MaintenanceBucket>)
      : {};
  const names = new Map(DEFAULT_SERVICE_ITEMS.map((i) => [i.id, i.name]));
  const rows: (string | number | null)[][] = [];
  for (const [car, bucket] of Object.entries(buckets)) {
    const entries = Array.isArray(bucket?.entries) ? [...bucket.entries] : [];
    entries.sort((a, b) => b.date - a.date);
    for (const e of entries) {
      rows.push([car, iso(e.date), names.get(e.itemId) ?? e.itemId, e.odoKm, e.note ?? '']);
    }
  }
  return csvRows(MAINTENANCE_CSV_HEADER, rows);
}

/** Total logbook entries across every car (the maintenance row of the restore summary). */
export function maintenanceEntryCount(state: unknown): number | null {
  const byVehicle = (state as { byVehicle?: unknown } | null)?.byVehicle;
  if (!byVehicle || typeof byVehicle !== 'object') return null;
  return Object.values(byVehicle as Record<string, MaintenanceBucket>).reduce(
    (n, b) => n + (Array.isArray(b?.entries) ? b.entries.length : 0),
    0,
  );
}
