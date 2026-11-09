import { useCallback, useState } from 'react';
import type { VehicleReportModel } from '@/shared/lib/vehicleReport';
import { exportVehicleReport, loadReportModules, type ReportFormat } from '../api/reportExport';

/** Share the vehicle report as PDF, HTML or Markdown (`api/reportExport.ts` does the work). Each
 *  share resolves with the file URI, or null when nothing was written; `sharePdf` also resolves
 *  null when `expo-print` is not available, and the screen then falls back to HTML. Every written
 *  report is recorded in history. */
export function useReportExport() {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (model: VehicleReportModel, format: ReportFormat): Promise<string | null> => {
      setBusy(true);
      try {
        return await exportVehicleReport(model, format, await loadReportModules());
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const sharePdf = useCallback((m: VehicleReportModel) => run(m, 'pdf'), [run]);
  const shareHtml = useCallback((m: VehicleReportModel) => run(m, 'html'), [run]);
  const shareMarkdown = useCallback((m: VehicleReportModel) => run(m, 'md'), [run]);

  return { sharePdf, shareHtml, shareMarkdown, busy };
}
