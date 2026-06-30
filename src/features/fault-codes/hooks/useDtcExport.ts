import { useCallback, useState } from 'react';
import { logError } from '@/shared/state/errorLogStore';

/** Write a fault-code Markdown report to a file (expo-file-system) and open the OS share sheet
 *  (expo-sharing). Both native modules are loaded via variable specifiers so the project builds and
 *  tests without them present — the same dependency-tolerant pattern used by useErrorLogExport and the
 *  trip recorder. `baseName` is the filename stem; a timestamp and `.md` are appended. Returns the
 *  file URI on success, or null when storage/sharing is unavailable (e.g. web/tests). */
export function useDtcExport() {
  const [busy, setBusy] = useState(false);

  const exportReport = useCallback(
    async (baseName: string, body: string): Promise<string | null> => {
      setBusy(true);
      try {
        const FileSystem = await import('expo-file-system' as string);
        const Sharing = await import('expo-sharing' as string);
        const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
        if (!dir) return null;

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uri = `${dir}${baseName}-${stamp}.md`;
        await FileSystem.writeAsStringAsync(uri, body);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'text/markdown',
            dialogTitle: 'Export fault codes',
          });
        }
        return uri;
      } catch (e) {
        // Don't let an export failure vanish — record it in the in-app error log.
        logError({ source: 'fault-codes/export', error: e });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { exportReport, busy };
}
