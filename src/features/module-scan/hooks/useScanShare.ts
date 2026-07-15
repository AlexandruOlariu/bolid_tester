import { useCallback, useState } from 'react';
import { logError } from '@/shared/state/errorLogStore';
import { formatAutoScanReport } from '../api/scanReport';
import type { SavedScan } from '../model/scanHistoryStore';

/** Share a saved auto-scan as the forum-pasteable VCDS-style text report (.txt), written to a file
 *  and handed to the OS share sheet. Both native modules are loaded via variable specifiers so the
 *  project builds and tests without them present — the same dependency-tolerant pattern as
 *  useDtcExport / useErrorLogExport. Returns the file URI on success, or null when storage/sharing is
 *  unavailable (web/tests). See docs/features/module-scan.md. */
export function useScanShare() {
  const [busy, setBusy] = useState(false);

  const shareReport = useCallback(async (scan: SavedScan): Promise<string | null> => {
    setBusy(true);
    try {
      const FileSystem = await import('expo-file-system' as string);
      const Sharing = await import('expo-sharing' as string);
      const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
      if (!dir) return null;

      const stamp = new Date(scan.ts).toISOString().replace(/[:.]/g, '-');
      const uri = `${dir}auto-scan-${stamp}.txt`;
      await FileSystem.writeAsStringAsync(uri, formatAutoScanReport(scan));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/plain',
          dialogTitle: 'Share auto-scan report',
        });
      }
      return uri;
    } catch (e) {
      logError({ source: 'module-scan/share', error: e });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { shareReport, busy };
}
