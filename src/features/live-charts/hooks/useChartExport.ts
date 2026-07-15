import { useCallback, useState } from 'react';
import { Point } from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';
import { seriesToCsv } from '../api/chartCsv';

/** Share the current chart window as a CSV file via the OS share sheet. Dependency-tolerant: a no-op
 *  when expo-file-system / expo-sharing are absent (tests, web) — same idiom as the DTC export. PNG
 *  export would need a new native dependency, so CSV is the share format for now. */
export function useChartExport() {
  const [busy, setBusy] = useState(false);

  const shareCsv = useCallback(async (baseName: string, series: Record<string, Point[]>) => {
    setBusy(true);
    try {
      const FileSystem = await import('expo-file-system' as string);
      const Sharing = await import('expo-sharing' as string);
      const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
      if (!dir) return null;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uri = `${dir}${baseName}-${stamp}.csv`;
      await FileSystem.writeAsStringAsync(uri, seriesToCsv(series));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Share chart window (CSV)' });
      }
      return uri;
    } catch (e) {
      logError({ source: 'live-charts/export', error: e });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { shareCsv, busy };
}
