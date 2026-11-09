/** Timeline adapters (plan 16): each turns one store's records into `TimelineItem`s for the pure
 *  merge in `src/shared/lib/timeline.ts`. Pure (no store reads, no I/O) — the screen's
 *  `useTimeline` hook reads the stores and hands their slices in. The title / subtitle / tone / link
 *  rules are the table in docs/features/history.md. */
import type { LogEntry, OverallHealth, ServiceItem } from '@/shared/obd-core';
import {
  historyVehicleChipLabel,
  historyVehicleKey,
  type HistoryEntry,
  type HistoryVehicle,
  type ReportHistoryEntry,
} from '@/shared/state/historyStore';
import { REPORT_SECTION_TITLES } from '@/shared/lib/vehicleReport';
import { timelineId, type TimelineItem, type TimelineTone } from '@/shared/lib/timeline';
import type { SavedScan } from '@/features/module-scan/model/scanHistoryStore';
import { tripCarKey, type TripSummary } from '@/features/trip-recording/model/tripStore';
import type { CarBackup } from '@/features/coding/api/carBackup';
import { translate } from '@/shared/i18n';
import { formatFixed } from '@/shared/lib/format';

/** Trips are not capped by their store; the timeline reads at most this many (newest first). */
export const MAX_TIMELINE_TRIPS = 500;

const OVERALL_TEXT: Record<OverallHealth, string> = {
  ok: 'healthy',
  attention: 'needs attention',
  urgent: 'urgent',
};

const OVERALL_TONE: Record<OverallHealth, TimelineTone> = {
  ok: 'ok',
  attention: 'warn',
  urgent: 'bad',
};

export const REPORT_FORMAT_LABEL: Record<ReportHistoryEntry['format'], string> = {
  pdf: 'PDF',
  html: 'HTML',
  md: 'Markdown',
};

function car(v: HistoryVehicle): Pick<TimelineItem, 'vehicleKey' | 'vehicleLabel'> {
  return { vehicleKey: historyVehicleKey(v), vehicleLabel: historyVehicleChipLabel(v) };
}

/** The first line of a (possibly multi-line) text, trimmed. */
function firstLine(s: string): string {
  return s.split(/\r?\n/)[0].trim();
}

/** "45 s", "12 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const totalS = Math.max(0, Math.round(ms / 1000));
  if (totalS < 60) return `${totalS} s`;
  const totalMin = Math.round(totalS / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** AI runs, fault-code checks and generated reports from `historyStore`. */
export function fromHistory(entries: HistoryEntry[]): TimelineItem[] {
  return entries.map((e): TimelineItem => {
    const base = {
      id: timelineId(e.kind, e.id),
      kind: e.kind,
      ts: e.ts,
      sourceId: e.id,
      ...car(e.vehicle),
    };
    if (e.kind === 'ai') {
      return {
        ...base,
        title: translate('history:item.ai', {
          overall: translate(`history:overall.${e.overall}`, {
            defaultValue: OVERALL_TEXT[e.overall] ?? e.overall,
          }),
        }),
        subtitle: firstLine(e.summary) || undefined,
        tone: OVERALL_TONE[e.overall] ?? 'neutral',
      };
    }
    if (e.kind === 'dtc') {
      const codes = e.stored.length + e.pending.length + e.permanent.length;
      const mil =
        e.milOn === null
          ? ''
          : ` · ${e.milOn ? translate('history:item.milOn') : translate('history:item.milOff')}`;
      return {
        ...base,
        title: translate('history:item.dtc'),
        subtitle: `${translate('history:item.dtcCounts', { stored: e.stored.length, pending: e.pending.length })}${mil}`,
        tone: e.milOn ? 'bad' : codes > 0 ? 'warn' : 'ok',
      };
    }
    return {
      ...base,
      title: translate('history:item.report', {
        format: REPORT_FORMAT_LABEL[e.format] ?? e.format,
      }),
      subtitle:
        e.sections.length > 0
          ? e.sections.map((id) => REPORT_SECTION_TITLES[id] ?? id).join(' · ')
          : translate('history:item.identityOnly'),
      tone: 'neutral',
    };
  });
}

/** Saved module scans. Each links to Module scan's compare with this scan as "after" and the
 *  previous scan **of the same car** as "before" (none for a car's first scan). `scans` is the
 *  store's newest-first list. */
export function fromScans(scans: SavedScan[]): TimelineItem[] {
  return scans.map((s, i): TimelineItem => {
    const key = historyVehicleKey(s.vehicle);
    const prev = scans.slice(i + 1).find((o) => historyVehicleKey(o.vehicle) === key);
    // UDS modules plus, on a pre-UDS car, the TP2.0 gateway's modules. A full scan keeps every
    // TP2.0 module a second time as a UDS result `skipped` (not scanned over UDS), and lists the
    // modules the gateway says are not fitted as `not-installed`: neither counts towards the total.
    const tp20 = s.tp20?.modules ?? [];
    const uds = s.modules.filter((m) => m.state !== 'skipped');
    const fitted = tp20.filter((m) => m.state !== 'not-installed');
    const faults =
      s.modules.reduce((n, m) => n + m.dtcs.length, 0) +
      tp20.reduce((n, m) => n + (m.dtcs?.length ?? 0), 0);
    const answered =
      uds.filter((m) => m.state === 'ok').length +
      fitted.filter((m) => m.state === 'ok' || m.state === 'refused').length;
    const total = uds.length + fitted.length;
    return {
      id: timelineId('scan', s.id),
      kind: 'scan',
      ts: s.ts,
      sourceId: s.id,
      ...car(s.vehicle),
      title: translate('history:item.scan', { count: faults }),
      subtitle: translate('history:item.scanAnswered', { answered, total }),
      tone: faults > 0 ? 'warn' : 'ok',
      link: {
        route: '/module-scan',
        params: prev ? { after: s.id, before: prev.id } : { after: s.id },
      },
    };
  });
}

/** Recorded trips (newest `MAX_TIMELINE_TRIPS`). `labelFor(carId, vin)` names the car the trip was
 *  recorded on (`tripCarKey`: the garage / registry id). */
export function fromTrips(
  trips: TripSummary[],
  labelFor: (carId: string, vin: string | null) => string,
): TimelineItem[] {
  return trips.slice(0, MAX_TIMELINE_TRIPS).map((t): TimelineItem => {
    const carId = tripCarKey(t);
    const vin = t.header.vin ?? null;
    const vehicle: HistoryVehicle = { id: carId, vin, label: labelFor(carId, vin) };
    const km = t.stats.distanceKm ?? t.stats.gps?.distanceKm ?? null;
    const gps = t.stats.gps ? ' · GPS' : '';
    return {
      id: timelineId('trip', t.header.id),
      kind: 'trip',
      ts: t.header.startedAt,
      sourceId: t.header.id,
      ...car(vehicle),
      title:
        km === null
          ? translate('history:item.trip')
          : translate('history:item.tripKm', { km: formatFixed(km, 1) }),
      subtitle: `${formatDuration(t.stats.durationMs)} · ${translate('history:item.samples', { count: t.stats.sampleCount })}${gps}`,
      tone: 'neutral',
      link: { route: '/trip-detail', params: { id: t.header.id } },
    };
  });
}

/** One car's maintenance log entries (one `maintenanceStore.byVehicle` bucket); `items` resolves the
 *  service name (an unknown item reads "Service"). */
export function fromMaintenance(
  entries: LogEntry[],
  items: ServiceItem[],
  vehicle: HistoryVehicle,
): TimelineItem[] {
  const names = new Map(items.map((i) => [i.id, i.name]));
  return entries.map((e): TimelineItem => {
    const name = names.get(e.itemId);
    const note = e.note?.trim() ? ` · ${firstLine(e.note)}` : '';
    return {
      id: timelineId('maintenance', e.id),
      kind: 'maintenance',
      ts: e.date,
      sourceId: e.id,
      ...car(vehicle),
      title: name
        ? translate('history:item.serviceNamed', {
            name: translate(`maintenance:item.${e.itemId}`, { defaultValue: name }),
          })
        : translate('history:item.service'),
      subtitle: `${e.odoKm} km${note}`,
      tone: 'ok',
      link: { route: '/maintenance' },
    };
  });
}

/** Full-car coding backups. */
export function fromBackups(backups: CarBackup[]): TimelineItem[] {
  return backups.map(
    (b): TimelineItem => ({
      id: timelineId('backup', b.id),
      kind: 'backup',
      ts: b.ts,
      sourceId: b.id,
      ...car(b.vehicle),
      title: translate('history:item.backup'),
      subtitle: translate('history:item.modules', { count: b.modules.length }),
      tone: 'neutral',
      link: { route: '/coding' },
    }),
  );
}
