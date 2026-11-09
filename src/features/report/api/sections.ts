/** Section mappers for the unified vehicle report (plan 15): pure functions from each store's shape
 *  to the report's own narrowed types in `@/shared/lib/vehicleReport`, so the hook stays thin and
 *  every mapping is unit-tested without React. The report slice is the sanctioned composition point
 *  for these features (the same rule as `engine-host`); nothing here reads a store. See
 *  docs/features/report.md. */
import {
  computeDue,
  decodeVin,
  PROTOCOL_LABELS,
  vagNativeDtcText,
  type AiReport,
  type BatteryReport,
  type DueInfo,
  type InspectionReport,
  type LogEntry,
  type ServiceItem,
} from '@/shared/obd-core';
import type { SessionInfo } from '@/shared/obd-core/session/DiagnosticSession';
import type { DtcResult } from '@/shared/state/dtcStore';
import {
  historyVehicleKey,
  type AiHistoryEntry,
  type DtcHistoryEntry,
  type HistoryEntry,
  type HistoryVehicle,
} from '@/shared/state/historyStore';
import { vehicleLabel, type VehicleProfile } from '@/shared/vehicles';
import { dtcCheckFromRead, type DtcCheckReport } from '@/shared/lib/dtcReport';
import type {
  ReportAi,
  ReportBattery,
  ReportIdentity,
  ReportInspection,
  ReportMaintenance,
  ReportScan,
  ReportScanModule,
  ReportSectionId,
} from '@/shared/lib/vehicleReport';
import { statusFlagText } from '@/features/module-scan/api/scanReport';
import type {
  SavedScan,
  SavedScanModule,
  SavedScanTp20Module,
} from '@/features/module-scan/model/scanHistoryStore';

/** A live fault-code read (the `dtcStore` result) as the fault-code report's shape — readiness,
 *  every code mode and all captured freeze frames. The mapping itself lives in
 *  `@/shared/lib/dtcReport` (`dtcCheckFromRead`) so the Faults screen, whose local `buildCheck` it
 *  replaced, uses it without importing this slice. */
export const faultsFromStores: (
  dtc: DtcResult,
  info: SessionInfo | null,
  profileLabel: string,
  opts?: { ts?: number; adapter?: string | null },
) => DtcCheckReport = dtcCheckFromRead;

/** A saved fault-code check from history (no freeze frames are kept there). */
export function faultsFromHistory(e: DtcHistoryEntry): DtcCheckReport {
  return {
    ts: e.ts,
    vehicleLabel: e.vehicle.label,
    vin: e.vehicle.vin,
    milOn: e.milOn,
    stored: e.stored,
    pending: e.pending,
    permanent: e.permanent,
    monitorsComplete: e.monitorsComplete,
    monitorsTotal: e.monitorsTotal,
  };
}

function scanModule(m: SavedScanModule): ReportScanModule {
  return {
    address: m.address,
    name: m.name,
    state: m.state === 'ok' ? 'answered' : m.state,
    partNumber: m.partNumber,
    systemName: m.systemName,
    faults:
      m.state === 'ok'
        ? m.dtcs.map((d) => ({
            display: d.display,
            vagCode: d.vagCode,
            description: d.description,
            statusText: statusFlagText(d.status),
          }))
        : [],
  };
}

function tp20Module(m: SavedScanTp20Module): ReportScanModule {
  return {
    address: m.address.toString(16).padStart(2, '0').toUpperCase(),
    name: m.name,
    state: m.dtcs ? 'answered' : m.state,
    systemName: m.ident,
    faults: (m.dtcs ?? []).map((d) => ({
      display: '',
      vagCode: d.vag,
      description: vagNativeDtcText(d.vag) ?? 'Fault text not in the table',
      statusText: `status 0x${d.status.toString(16).padStart(2, '0').toUpperCase()}`,
    })),
  };
}

/** A saved auto-scan as the report's scan section. The counts are computed over the UDS modules
 *  exactly as `formatAutoScanReport`'s header computes them; TP2.0 modules follow in `preUds`. */
export function scanFromSaved(scan: SavedScan): ReportScan {
  const answered = scan.modules.filter((m) => m.state === 'ok');
  return {
    ts: scan.ts,
    protocol: scan.protocol,
    modules: scan.modules.map(scanModule),
    preUds: (scan.tp20?.modules ?? []).map(tp20Module),
    answered: answered.length,
    withFaults: answered.filter((m) => m.dtcs.length > 0).length,
    totalFaults: answered.reduce((n, m) => n + m.dtcs.length, 0),
  };
}

export function inspectionFrom(
  report: InspectionReport | null,
  ranAt: number | null,
): ReportInspection | null {
  if (!report) return null;
  return {
    ts: ranAt,
    verdict: report.verdict,
    score: report.score,
    checks: report.checks.map((c) => ({ label: c.label, status: c.status, detail: c.detail })),
  };
}

export function batteryFrom(
  report: BatteryReport | null,
  ranAt: number | null,
): ReportBattery | null {
  if (!report) return null;
  return {
    ts: ranAt,
    restingV: report.restingV,
    crankingDipV: report.crankingDipV,
    chargingV: report.chargingV,
    socPct: report.socPct,
    verdict: report.verdict,
    notes: [...report.notes],
  };
}

export function aiFrom(report: AiReport | null, ranAt: number | null): ReportAi | null {
  if (!report) return null;
  return {
    ts: ranAt,
    source: report.source,
    overall: report.overall,
    summary: report.summary,
    findings: report.findings.map((f) => ({
      title: f.title,
      severity: f.severity,
      detail: f.detail,
      codes: f.codes,
    })),
    disclaimer: report.disclaimer,
  };
}

const DUE_ORDER: Record<DueInfo['status'], number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 };

/** The car's "what's due" list, worst-first (overdue → soon → ok → no record), as the maintenance
 *  screen sorts it. Null when the logbook is empty — nothing has been logged, so every item would
 *  read "no record". */
export function maintenanceFrom(
  items: ServiceItem[],
  entries: LogEntry[],
  odoKm: number | null,
  now: number = Date.now(),
): ReportMaintenance | null {
  if (entries.length === 0) return null;
  const due = computeDue(items, entries, { odoKm, now }).sort(
    (a, b) => DUE_ORDER[a.status] - DUE_ORDER[b.status],
  );
  return {
    odoKm,
    due: due.map((d) => ({
      name: d.name,
      status: d.status,
      dueInKm: d.dueInKm,
      dueInDays: d.dueInDays,
      lastOdoKm: d.lastOdoKm,
      lastDate: d.lastDate,
    })),
  };
}

/** The report's identity block. Connected: the live session info. Offline: `fallback` (VIN and
 *  protocol from the last stored records) and the "last connection" note. Decodes the VIN. */
export function identityFrom(
  profile: VehicleProfile,
  info: SessionInfo | null,
  deviceName: string | null,
  fallback: { vin?: string | null; protocol?: string | null; lastSeenAt?: number | null } = {},
): ReportIdentity {
  const connected = info !== null;
  const vin = info?.vin ?? fallback.vin ?? null;
  let vinDecoded: ReportIdentity['vinDecoded'];
  if (vin) {
    const d = decodeVin(vin);
    if (d.validFormat) {
      vinDecoded = {
        manufacturer: d.manufacturer,
        country: d.country,
        modelYear: d.modelYear,
        checkDigitOk: d.checkDigit.applicable ? d.checkDigit.valid : null,
      };
    }
  }
  return {
    label: vehicleLabel(profile),
    vin,
    vinDecoded,
    profileId: profile.id,
    year: profile.year || undefined,
    engine: profile.engine || undefined,
    fuel: profile.fuel,
    protocol: info ? PROTOCOL_LABELS[info.protocol] : (fallback.protocol ?? null),
    adapter: deviceName,
    elmVersion: info?.version || null,
    voltage: info?.voltage ?? null,
    supportedPidCount: info ? info.supportedPids.length : null,
    calibrationId: info?.calibrationId ?? null,
    connected,
    lastSeenAt: connected ? null : (fallback.lastSeenAt ?? null),
  };
}

/** Does a stored record belong to the active car? With a known VIN, a record carrying a VIN must
 *  match it (`historyVehicleKey`), and a record without one matches by profile id; without a VIN,
 *  the profile id decides. */
export function belongsToCar(v: HistoryVehicle, profileId: string, vin: string | null): boolean {
  if (vin && v.vin) return historyVehicleKey(v) === historyVehicleKey({ ...v, vin });
  return v.id === profileId;
}

/** Everything the report hook reads, as plain values (one snapshot of the stores). */
export interface ReportStoreSnapshot {
  profile: VehicleProfile;
  /** VIN the garage learned for this car, if any. */
  learnedVin: string | null;
  info: SessionInfo | null;
  deviceName: string | null;
  /** The live read. `readFor` is the car it was read from — null when there are no results (never
   *  read, or emptied by `clearResults` with no session), which sends the report to history. */
  dtc: DtcResult & { lastReadAt: number | null; readFor: HistoryVehicle | null };
  scans: SavedScan[];
  history: HistoryEntry[];
  /** In-memory results; `ranFor` is the car each was produced for (null with no report). */
  inspection: {
    report: InspectionReport | null;
    ranAt: number | null;
    ranFor: HistoryVehicle | null;
  };
  battery: { report: BatteryReport | null; ranAt: number | null; ranFor: HistoryVehicle | null };
  ai: { report: AiReport | null; ranAt: number | null; ranFor: HistoryVehicle | null };
  maintenance: { items: ServiceItem[]; entries: LogEntry[]; odoKm: number | null };
  now?: number;
}

export interface ReportSources {
  identity: ReportIdentity;
  faults: DtcCheckReport | null;
  scan: ReportScan | null;
  inspection: ReportInspection | null;
  battery: ReportBattery | null;
  ai: ReportAi | null;
  maintenance: ReportMaintenance | null;
}

/** Map a store snapshot to every section's data. The live in-memory results win when they were
 *  produced for this car (their `readFor` / `ranFor` stamp passes `belongsToCar`); otherwise —
 *  offline, after a restart, after `clearResults`, or with another garage car's results still in
 *  memory — the fault codes and the AI summary fall back to this car's newest history entry, and
 *  inspection / battery (never kept in history) are left out. The scan is always this car's newest
 *  saved scan. Pure. */
export function collectReportSources(s: ReportStoreSnapshot): ReportSources {
  const { profile } = s;
  const now = s.now ?? Date.now();
  // VIN: the live session's, else the garage's learned one, else the newest stored record's.
  const byId = (v: HistoryVehicle) => v.id === profile.id;
  const storedVin =
    s.scans.find((sc) => byId(sc.vehicle) && sc.vehicle.vin)?.vehicle.vin ??
    s.history.find((e) => byId(e.vehicle) && e.vehicle.vin)?.vehicle.vin ??
    null;
  const vin = s.info?.vin ?? s.learnedVin ?? storedVin;
  const mine = (v: HistoryVehicle) => belongsToCar(v, profile.id, vin);
  const mineLive = (v: HistoryVehicle | null): v is HistoryVehicle => v !== null && mine(v);

  const savedScan = s.scans.find((sc) => mine(sc.vehicle)) ?? null;
  const dtcEntry = s.history.find((e): e is DtcHistoryEntry => e.kind === 'dtc' && mine(e.vehicle));
  const aiEntry = s.history.find((e): e is AiHistoryEntry => e.kind === 'ai' && mine(e.vehicle));

  const faults =
    s.dtc.lastReadAt !== null && mineLive(s.dtc.readFor)
      ? faultsFromStores(s.dtc, s.info, vehicleLabel(profile), {
          ts: s.dtc.lastReadAt,
          adapter: s.deviceName,
        })
      : dtcEntry
        ? faultsFromHistory(dtcEntry)
        : null;
  const ai =
    s.ai.report && mineLive(s.ai.ranFor)
      ? aiFrom(s.ai.report, s.ai.ranAt)
      : aiEntry
        ? aiFrom(aiEntry.report, aiEntry.ts)
        : null;

  const scan = savedScan ? scanFromSaved(savedScan) : null;
  const inspection = mineLive(s.inspection.ranFor)
    ? inspectionFrom(s.inspection.report, s.inspection.ranAt)
    : null;
  const battery = mineLive(s.battery.ranFor)
    ? batteryFrom(s.battery.report, s.battery.ranAt)
    : null;

  // "Last connection": the newest time among everything this report prints (live or saved) and
  // this car's newest history entries, so the identity block is never older than a section below.
  const stamps = [
    scan?.ts,
    faults?.ts,
    inspection?.ts,
    battery?.ts,
    ai?.ts,
    dtcEntry?.ts,
    aiEntry?.ts,
  ].filter((t): t is number => typeof t === 'number');
  const identity = identityFrom(profile, s.info, s.deviceName, {
    vin,
    protocol: savedScan?.protocol ?? null,
    lastSeenAt: stamps.length ? Math.max(...stamps) : null,
  });

  return {
    identity,
    faults,
    scan,
    inspection,
    battery,
    ai,
    maintenance: maintenanceFrom(
      s.maintenance.items,
      s.maintenance.entries,
      s.maintenance.odoKm,
      now,
    ),
  };
}

/** Which sections have data to include. */
export function availableSections(src: ReportSources): Record<ReportSectionId, boolean> {
  return {
    faults: src.faults !== null,
    scan: src.scan !== null,
    inspection: src.inspection !== null,
    battery: src.battery !== null,
    ai: src.ai !== null,
    maintenance: src.maintenance !== null,
  };
}
