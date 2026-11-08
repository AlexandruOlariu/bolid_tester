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

interface LegacyFileSystem {
  documentDirectory?: string | null;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
}
interface SharingModule {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (
    uri: string,
    opts?: { mimeType?: string; dialogTitle?: string; UTI?: string },
  ) => Promise<void>;
}

/** Write the file to the app's document directory and open the share sheet. Returns the file URI,
 *  or null when there is nowhere to write (web/tests) or the write failed (logged). The legacy
 *  file-system entry point is used: on this Expo SDK the root `expo-file-system` throws for
 *  `writeAsStringAsync`. */
export async function shareCaptureFile(file: CaptureFile): Promise<string | null> {
  try {
    const FileSystem = (await import('expo-file-system/legacy' as string)) as LegacyFileSystem;
    const Sharing = (await import('expo-sharing' as string)) as SharingModule;
    const dir = FileSystem.documentDirectory ?? '';
    if (!dir) return null;
    const uri = `${dir}${file.fileName}`;
    await FileSystem.writeAsStringAsync(uri, file.body);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: 'Share bus capture' });
    }
    return uri;
  } catch (e) {
    logError({ source: 'can-sniffer/export', error: e });
    return null;
  }
}
