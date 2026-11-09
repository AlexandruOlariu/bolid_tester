/** Writing and sharing the unified vehicle report (plan 15). `loadReportModules` loads the native
 *  modules with variable specifiers (tolerant imports — tests and web build without them);
 *  `exportVehicleReport` takes them as a parameter, so it is unit-tested with fakes in the core
 *  project. See docs/features/report.md. */
import { logError } from '@/shared/state/errorLogStore';
import { isWebRuntime } from '@/shared/lib/webRuntime';
import { NOT_ON_WEB_YET, showToast } from '@/shared/state/toastStore';
import { useHistoryStore } from '@/shared/state/historyStore';
import {
  renderReportHtml,
  renderReportMarkdown,
  reportFileStem,
  reportSections,
  type VehicleReportModel,
} from '@/shared/lib/vehicleReport';

export type ReportFormat = 'pdf' | 'html' | 'md';

/** The legacy file-system entry point: on this Expo SDK the root `expo-file-system` has no
 *  `documentDirectory` and throws for `writeAsStringAsync` (see `can-sniffer/api/captureExport.ts`). */
export interface ReportFileSystem {
  documentDirectory?: string | null;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
  moveAsync: (opts: { from: string; to: string }) => Promise<void>;
}
export interface ReportSharing {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void>;
}
export interface ReportPrint {
  printToFileAsync: (opts: { html: string }) => Promise<{ uri: string }>;
}
export interface ReportModules {
  FileSystem: ReportFileSystem;
  Sharing: ReportSharing;
  /** null when `expo-print` is not in this build (web / tests). */
  Print: ReportPrint | null;
}

const SOURCE = 'report/export';

export const REPORT_MIME: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  html: 'text/html',
  md: 'text/markdown',
};

/** Load expo-file-system (legacy), expo-sharing and expo-print. Resolves null when the file system
 *  or sharing is missing; `Print` is null on its own when only printing is missing. */
export async function loadReportModules(): Promise<ReportModules | null> {
  // Web (plan 28): no file system to write the report to yet.
  if (isWebRuntime()) {
    showToast(NOT_ON_WEB_YET);
    return null;
  }
  let FileSystem: ReportFileSystem;
  let Sharing: ReportSharing;
  try {
    FileSystem = (await import('expo-file-system/legacy' as string)) as ReportFileSystem;
    Sharing = (await import('expo-sharing' as string)) as ReportSharing;
  } catch (e) {
    logError({ source: SOURCE, error: e, severity: 'warning' });
    return null;
  }
  let Print: ReportPrint | null = null;
  try {
    const mod = (await import('expo-print' as string)) as Partial<ReportPrint>;
    if (typeof mod.printToFileAsync === 'function') Print = mod as ReportPrint;
  } catch {
    Print = null; // no native print module: PDF is unavailable, HTML / Markdown still work
  }
  return { FileSystem, Sharing, Print };
}

/** Record the shared report in history so the per-car timeline (plan 16) can list it. */
function recordReport(model: VehicleReportModel, format: ReportFormat, fileName: string): void {
  const { identity } = model;
  useHistoryStore.getState().addReportRun({
    vehicle: { id: identity.profileId, label: identity.label, vin: identity.vin },
    sections: reportSections(model),
    format,
    fileName,
  });
}

/** Write the report as `<reportFileStem>.<format>` in the document directory (a PDF is printed by
 *  `expo-print` from the HTML, then moved there under that name), record it in history, and open
 *  the share sheet. Resolves with the file URI, or null when nothing was written: no modules, no
 *  document directory, no printer for a PDF, or a write failure (logged as `report/export`). A
 *  failing share sheet after the write is logged as a warning and still resolves the URI. */
export async function exportVehicleReport(
  model: VehicleReportModel,
  format: ReportFormat,
  mods: ReportModules | null,
): Promise<string | null> {
  if (!mods) return null;
  const { FileSystem, Sharing, Print } = mods;
  if (format === 'pdf' && !Print) return null;
  try {
    const dir = FileSystem.documentDirectory ?? '';
    if (!dir) return null;
    const fileName = `${reportFileStem(model)}.${format}`;
    const uri = `${dir}${fileName}`;
    if (format === 'pdf' && Print) {
      const { uri: printed } = await Print.printToFileAsync({ html: renderReportHtml(model) });
      await FileSystem.moveAsync({ from: printed, to: uri });
    } else {
      const body = format === 'html' ? renderReportHtml(model) : renderReportMarkdown(model);
      await FileSystem.writeAsStringAsync(uri, body);
    }
    recordReport(model, format, fileName);
    // The file is written and recorded from here on: a share-sheet failure (e.g. Android rejecting
    // a second share while one is open) is logged but still resolves the URI, so the screen does
    // not mistake it for "no PDF printer" and write a second, HTML copy.
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: REPORT_MIME[format],
          dialogTitle: 'Share vehicle report',
        });
      }
    } catch (e) {
      logError({
        source: SOURCE,
        error: e,
        severity: 'warning',
        context: { format, step: 'share' },
      });
    }
    return uri;
  } catch (e) {
    logError({ source: SOURCE, error: e, context: { format } });
    return null;
  }
}
