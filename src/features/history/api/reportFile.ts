/** Re-share a generated vehicle report from the timeline (plan 16). The report slice writes each
 *  report to `<documentDirectory><fileName>` (plan 15, `report/api/reportExport.ts`) and records the
 *  file name in history; this re-opens the share sheet for that file when it is still on the device.
 *  The native modules are loaded with variable specifiers (tolerant imports) and handed to
 *  `reshareReport` as a parameter, so it is unit-tested with fakes. See docs/features/history.md. */
import { logError } from '@/shared/state/errorLogStore';
import { isWebRuntime } from '@/shared/lib/webRuntime';
import { NOT_ON_WEB_YET, showToast } from '@/shared/state/toastStore';
import type { ReportHistoryEntry } from '@/shared/state/historyStore';
import { translate } from '@/shared/i18n';

export interface ReshareFileSystem {
  documentDirectory?: string | null;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean }>;
}
export interface ReshareSharing {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void>;
}
export interface ReshareModules {
  FileSystem: ReshareFileSystem;
  Sharing: ReshareSharing;
}

/** `shared` the sheet opened · `missing` the file is no longer on the device · `unavailable` no
 *  file system / sharing on this device (or the share failed — logged). */
export type ReshareResult = 'shared' | 'missing' | 'unavailable';

const SOURCE = 'history/reshare-report';

const MIME: Record<ReportHistoryEntry['format'], string> = {
  pdf: 'application/pdf',
  html: 'text/html',
  md: 'text/markdown',
};

/** Load expo-file-system (legacy entry point: the root one has no `documentDirectory` on this SDK)
 *  and expo-sharing; null when either is missing. */
export async function loadReshareModules(): Promise<ReshareModules | null> {
  // Web (plan 28): reports are never written to a file there, so there is nothing to re-share.
  if (isWebRuntime()) {
    showToast(NOT_ON_WEB_YET);
    return null;
  }
  try {
    const FileSystem = (await import('expo-file-system/legacy' as string)) as ReshareFileSystem;
    const Sharing = (await import('expo-sharing' as string)) as ReshareSharing;
    return { FileSystem, Sharing };
  } catch (e) {
    logError({ source: SOURCE, error: e, severity: 'warning' });
    return null;
  }
}

/** Where the report slice wrote the file, or null without a document directory. */
export function reportFileUri(
  fileName: string,
  documentDirectory: string | null | undefined,
): string | null {
  return documentDirectory ? `${documentDirectory}${fileName}` : null;
}

/** Re-open the share sheet for a recorded report if its file still exists. */
export async function reshareReport(
  entry: Pick<ReportHistoryEntry, 'fileName' | 'format'>,
  mods: ReshareModules | null,
): Promise<ReshareResult> {
  if (!mods) return 'unavailable';
  const uri = reportFileUri(entry.fileName, mods.FileSystem.documentDirectory);
  if (!uri) return 'unavailable';
  try {
    const info = await mods.FileSystem.getInfoAsync(uri);
    if (!info.exists) return 'missing';
    if (!(await mods.Sharing.isAvailableAsync())) return 'unavailable';
    await mods.Sharing.shareAsync(uri, {
      mimeType: MIME[entry.format],
      dialogTitle: translate('common:share.vehicleReport'),
    });
    return 'shared';
  } catch (e) {
    logError({ source: SOURCE, error: e, severity: 'warning', context: { format: entry.format } });
    return 'unavailable';
  }
}
