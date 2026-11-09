import { useCallback, useState } from 'react';
import { logError } from '@/shared/state/errorLogStore';
import { fileStamp, saveTextFile } from '@/shared/lib/saveFile';
import { formatAutoScanReport } from '../api/scanReport';
import type { SavedScan } from '../model/scanHistoryStore';

/** Share a saved auto-scan as the forum-pasteable VCDS-style text report (.txt): written to a file
 *  and handed to the OS share sheet on native, downloaded on web (`saveTextFile`, plan 28). Returns
 *  the file URI (native) or name (web), or null when nothing was written. See
 *  docs/features/module-scan.md. */
export function useScanShare() {
  const [busy, setBusy] = useState(false);

  const shareReport = useCallback(async (scan: SavedScan): Promise<string | null> => {
    setBusy(true);
    try {
      return await saveTextFile(
        `auto-scan-${fileStamp(scan.ts)}.txt`,
        formatAutoScanReport(scan),
        'text/plain',
        { dialogTitle: 'Share auto-scan report' },
      );
    } catch (e) {
      logError({ source: 'module-scan/share', error: e });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { shareReport, busy };
}
