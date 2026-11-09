import { useCallback, useState } from 'react';
import { Point } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';
import { fileStamp, saveTextFile } from '@/shared/lib/saveFile';
import { seriesToCsv } from '../api/chartCsv';

/** Share the current chart window as a CSV file: the OS share sheet on native, a browser download on
 *  web (`saveTextFile`, plan 28). PNG export would need a new native dependency, so CSV is the share
 *  format for now. */
export function useChartExport() {
  const [busy, setBusy] = useState(false);

  const shareCsv = useCallback(
    async (baseName: string, series: Record<string, Point[]>, labels?: Record<string, string>) => {
      setBusy(true);
      try {
        return await saveTextFile(
          `${baseName}-${fileStamp()}.csv`,
          seriesToCsv(series, labels),
          'text/csv',
          { dialogTitle: 'Share chart window (CSV)' },
        );
      } catch (e) {
        logError({ source: 'live-charts/export', error: e });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { shareCsv, busy };
}
