import { useCallback, useState } from 'react';
import { logError } from '@/shared/state/errorLogStore';
import { fileStamp, saveTextFile } from '@/shared/lib/saveFile';
import { translate } from '@/shared/i18n';

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

/** Save a fault-code report: a document-directory file + the OS share sheet on native, a browser
 *  download on web (`saveTextFile`, plan 28). `baseName` is the filename stem; a timestamp and the
 *  extension (`.md` by default, `.html` for the HTML report) are appended. Returns the file URI
 *  (native) or name (web), or null when nothing was written. */
export function useDtcExport() {
  const [busy, setBusy] = useState(false);

  const exportReport = useCallback(
    async (
      baseName: string,
      body: string,
      opts: ExportReportOptions = {},
    ): Promise<string | null> => {
      setBusy(true);
      try {
        return await saveTextFile(
          `${baseName}-${fileStamp()}.${opts.ext ?? 'md'}`,
          body,
          opts.mimeType ?? 'text/markdown',
          { dialogTitle: opts.dialogTitle ?? translate('faultCodes:export.dialog') },
        );
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
