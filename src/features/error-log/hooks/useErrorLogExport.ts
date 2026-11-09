import { useCallback, useState } from 'react';
import { formatErrorsForExport, errorsToJson, type LoggedError } from '@/shared/lib/errorLog';
import { logError } from '@/shared/state/errorLogStore';
import { fileStamp, saveTextFile } from '@/shared/lib/saveFile';

export type ExportFormat = 'md' | 'json';

/** Save the errors as a file: on native, written to the document directory and handed to the OS
 *  share sheet; on web, downloaded by the browser (`saveTextFile`, plan 28). Returns the file URI
 *  (native) or name (web), or null when nothing was written. */
export function useErrorLogExport() {
  const [busy, setBusy] = useState(false);

  const exportErrors = useCallback(
    async (errors: LoggedError[], format: ExportFormat = 'md'): Promise<string | null> => {
      setBusy(true);
      try {
        const isJson = format === 'json';
        return await saveTextFile(
          `bolid-errors-${fileStamp()}.${isJson ? 'json' : 'md'}`,
          isJson ? errorsToJson(errors) : formatErrorsForExport(errors),
          isJson ? 'application/json' : 'text/markdown',
          { dialogTitle: 'Export error log' },
        );
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
