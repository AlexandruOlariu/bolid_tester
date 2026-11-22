import { useCallback, useMemo } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useDtcStore } from '@/shared/state/dtcStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { APP_VERSION } from '@/shared/lib/appInfo';
import {
  buildVehicleReport,
  type ReportSectionId,
  type VehicleReportModel,
} from '@/shared/lib/vehicleReport';
import { useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import { useInspectionStore } from '@/features/inspection/model/inspectionStore';
import { useBatteryStore } from '@/features/battery-health/model/batteryStore';
import { useAiDiagnoseStore } from '@/features/ai-diagnose/model/aiDiagnoseStore';
import {
  bucketFor,
  maintenanceKeysFor,
  useMaintenanceStore,
} from '@/features/maintenance/model/maintenanceStore';
import { availableSections, collectReportSources } from '../api/sections';

/** Reads every store the unified vehicle report draws on (session, fault codes, saved scans,
 *  history, inspection, battery, AI, the car's maintenance logbook), maps them through the pure
 *  section mappers, and exposes which sections have data plus `build(include)`. Works offline: the
 *  identity then comes from the last connection's stored records. See docs/features/report.md. */
export function useVehicleReport() {
  const profile = useActiveProfile();
  const vehicles = useGarageStore((s) => s.vehicles);
  const info = useSessionStore((s) => s.info);
  const deviceName = useSessionStore((s) => s.deviceName);
  const stored = useDtcStore((s) => s.stored);
  const pending = useDtcStore((s) => s.pending);
  const permanent = useDtcStore((s) => s.permanent);
  const readiness = useDtcStore((s) => s.readiness);
  const freezeFrames = useDtcStore((s) => s.freezeFrames);
  const lastReadAt = useDtcStore((s) => s.lastReadAt);
  const readFor = useDtcStore((s) => s.readFor);
  const scans = useScanHistoryStore((s) => s.scans);
  const history = useHistoryStore((s) => s.entries);
  const inspectionReport = useInspectionStore((s) => s.report);
  const inspectionAt = useInspectionStore((s) => s.ranAt);
  const inspectionFor = useInspectionStore((s) => s.ranFor);
  const batteryReport = useBatteryStore((s) => s.report);
  const batteryAt = useBatteryStore((s) => s.ranAt);
  const batteryFor = useBatteryStore((s) => s.ranFor);
  const aiReport = useAiDiagnoseStore((s) => s.report);
  const aiAt = useAiDiagnoseStore((s) => s.ranAt);
  const aiFor = useAiDiagnoseStore((s) => s.ranFor);
  const items = useMaintenanceStore((s) => s.items);
  const byVehicle = useMaintenanceStore((s) => s.byVehicle);

  const sources = useMemo(() => {
    const bucket = bucketFor(byVehicle, maintenanceKeysFor(profile.id, vehicles));
    return collectReportSources({
      profile,
      learnedVin: vehicles.find((v) => v.id === profile.id)?.learned?.vin ?? null,
      info,
      deviceName,
      dtc: { stored, pending, permanent, readiness, freezeFrames, lastReadAt, readFor },
      scans,
      history,
      inspection: { report: inspectionReport, ranAt: inspectionAt, ranFor: inspectionFor },
      battery: { report: batteryReport, ranAt: batteryAt, ranFor: batteryFor },
      ai: { report: aiReport, ranAt: aiAt, ranFor: aiFor },
      maintenance: { items, entries: bucket.entries, odoKm: bucket.odoKm },
    });
  }, [
    profile,
    vehicles,
    info,
    deviceName,
    stored,
    pending,
    permanent,
    readiness,
    freezeFrames,
    lastReadAt,
    readFor,
    scans,
    history,
    inspectionReport,
    inspectionAt,
    inspectionFor,
    batteryReport,
    batteryAt,
    batteryFor,
    aiReport,
    aiAt,
    aiFor,
    items,
    byVehicle,
  ]);

  const available = useMemo(() => availableSections(sources), [sources]);

  const build = useCallback(
    (include: ReportSectionId[], now: number = Date.now()): VehicleReportModel =>
      buildVehicleReport({ ...sources, include, appVersion: APP_VERSION, now }),
    [sources],
  );

  return { identity: sources.identity, available, build };
}
