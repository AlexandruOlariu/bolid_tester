import { useCallback, useState } from 'react';
import { logError } from '@/shared/state/errorLogStore';

/** Optional format overrides for a report export. Defaults produce the Markdown report; the Faults
 *  screen passes `{ ext: 'html', mimeType: 'text/html' }` for the shareable HTML report. */
export interface ExportReportOptions {
  /** File extension without the leading dot. Default `'md'`. */
  ext?: string;
  /** MIME type advertised to the OS share sheet. Default `'text/markdown'`. */
  mimeType?: string;
  /** Share-sheet dialog title. Default `'Export fault codes'`. */
  dialogTitle?: string;
}

/** Write a fault-code report to a file (expo-file-system) and open the OS share sheet (expo-sharing).
 *  Both native modules are loaded via variable specifiers so the project builds and tests without them
 *  present — the same dependency-tolerant pattern used by useErrorLogExport and the trip recorder.
 *  `baseName` is the filename stem; a timestamp and the extension (`.md` by default, `.html` for the
 *  HTML report) are appended. Returns the file URI on success, or null when storage/sharing is
 *  unavailable (e.g. web/tests). */
export function useDtcExport() {
  const [busy, setBusy] = useState(false);

  const exportReport = useCallback(
    async (baseName: string, body: string, opts: ExportReportOptions = {}): Promise<string | null> => {
      setBusy(true);
      try {
        const FileSystem = await import('expo-file-system' as string);
        const Sharing = await import('expo-sharing' as string);
        const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
        if (!dir) return null;

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uri = `${dir}${baseName}-${stamp}.${opts.ext ?? 'md'}`;
        await FileSystem.writeAsStringAsync(uri, body);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: opts.mimeType ?? 'text/markdown',
            dialogTitle: opts.dialogTitle ?? 'Export fault codes',
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
