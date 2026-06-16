import { useCallback, useState } from 'react';
import { formatErrorsForExport, errorsToJson, type LoggedError } from '@/shared/lib/errorLog';
import { logError } from '@/shared/state/errorLogStore';

export type ExportFormat = 'md' | 'json';

/** Write the saved errors to a file (expo-file-system) and open the OS share sheet (expo-sharing).
 *  Both native modules are loaded via variable specifiers so this builds/tests without them — the
 *  same dependency-tolerant pattern used by the trip recorder and notifier. Returns the file URI on
 *  success, or null when sharing is unavailable (e.g. web/tests). */
export function useErrorLogExport() {
  const [busy, setBusy] = useState(false);

  const exportErrors = useCallback(
    async (errors: LoggedError[], format: ExportFormat = 'md'): Promise<string | null> => {
      setBusy(true);
      try {
        const FileSystem = await import('expo-file-system' as string);
        const Sharing = await import('expo-sharing' as string);
        const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
        if (!dir) return null;

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const isJson = format === 'json';
        const uri = `${dir}bolid-errors-${stamp}.${isJson ? 'json' : 'md'}`;
        const body = isJson ? errorsToJson(errors) : formatErrorsForExport(errors);
        await FileSystem.writeAsStringAsync(uri, body);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: isJson ? 'application/json' : 'text/markdown',
            dialogTitle: 'Export error log',
          });
        }
        return uri;
      } catch (e) {
        // Don't let an export failure vanish — record it in the same zone.
        logError({ source: 'error-log/export', error: e });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { exportErrors, busy };
}
