/** Turn a sniffer capture into a shareable file: header from the live session, CSV or raw body,
 *  a `bolid-sniff-<vehicleId>-<stamp>` name, then write + OS share sheet. The native modules are
 *  loaded via variable specifiers so this builds and tests without them (same idiom as the
 *  error-log export). See docs/features/can-sniffer.md. */
import {
  formatCaptureCsv,
  formatCaptureRaw,
  type CapturedLine,
  type CaptureHeader,
  type SessionInfo,
} from '@/shared/obd-core';
import { logError } from '@/shared/state/errorLogStore';
import { saveTextFile } from '@/shared/lib/saveFile';
import { translate } from '@/shared/i18n';

export type CaptureFormat = 'csv' | 'raw';

export interface CaptureFile {
  fileName: string;
  mimeType: string;
  body: string;
}

/** Header for a capture: protocol + adapter version from the session info, the BLE device name
 *  when known. */
export function buildCaptureHeader(input: {
  vehicleId: string;
  info: SessionInfo | null;
  deviceName?: string | null;
  startedAt: number;
  note?: string;
  dropped?: number;
  appVersion?: string;
}): CaptureHeader {
  const { info, deviceName } = input;
  const adapter = [info?.version, deviceName ? `(${deviceName})` : ''].filter(Boolean).join(' ');
  return {
    vehicleId: input.vehicleId,
    protocol: info?.protocol,
    adapter: adapter || undefined,
    startedAt: input.startedAt,
    note: input.note?.trim() || undefined,
    appVersion: input.appVersion,
    dropped: input.dropped ?? 0,
  };
}

/** `bolid-sniff-<vehicleId>-<ISO stamp>.csv|.txt` — file-system-safe. */
export function captureFileName(
  vehicleId: string,
  format: CaptureFormat,
  now = new Date(),
): string {
  const id = vehicleId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `bolid-sniff-${id}-${stamp}.${format === 'csv' ? 'csv' : 'txt'}`;
}

export function buildCaptureFile(
  format: CaptureFormat,
  header: CaptureHeader,
  lines: CapturedLine[],
  now = new Date(),
): CaptureFile {
  return format === 'csv'
    ? {
        fileName: captureFileName(header.vehicleId, 'csv', now),
        mimeType: 'text/csv',
        body: formatCaptureCsv(header, lines),
      }
    : {
        fileName: captureFileName(header.vehicleId, 'raw', now),
        mimeType: 'text/plain',
        body: formatCaptureRaw(header, lines),
      };
}

/** Save the capture: written to the app's document directory and handed to the share sheet on
 *  native, downloaded by the browser on web (`saveTextFile`, plan 28; the legacy file-system entry
 *  point — on this Expo SDK the root `expo-file-system` throws for `writeAsStringAsync`). Returns
 *  the file URI (native) or name (web), or null when there is nowhere to write or the write failed
 *  (logged). */
export async function shareCaptureFile(file: CaptureFile): Promise<string | null> {
  try {
    return await saveTextFile(file.fileName, file.body, file.mimeType, {
      dialogTitle: translate('common:share.busCapture'),
    });
  } catch (e) {
    logError({ source: 'can-sniffer/export', error: e });
    return null;
  }
}
