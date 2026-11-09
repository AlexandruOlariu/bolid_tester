/** **Share garage as JSON** (plan 06): write the garage to `bolid-garage-<stamp>.json` in the app's
 *  document directory and open the OS share sheet. Uses the legacy file-system entry point: on this
 *  Expo SDK the root `expo-file-system` has no `documentDirectory` and throws for
 *  `writeAsStringAsync` (same as the sniffer's `captureExport.ts` and the Settings replay export).
 *  Native modules load with a variable specifier, so a platform without them (web) degrades to a
 *  logged warning instead of a crash. Import is plan 13. */
import { garageExportJson } from '@/shared/state/garageStore';
import { logError } from '@/shared/state/errorLogStore';
import type { UserVehicle } from '@/shared/vehicles';

interface LegacyFileSystem {
  documentDirectory?: string | null;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
}
interface SharingModule {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void>;
}

const SOURCE = 'vehicle-select/export';

/** `bolid-garage-<ISO stamp with : and . replaced>.json`. Pure. */
export function garageExportFileName(now: Date = new Date()): string {
  return `bolid-garage-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** Resolves with the written file URI, or null when nothing was written. Every null is logged as a
 *  `vehicle-select/export` warning, including the "no document directory" case. */
export async function saveGarageExport(
  vehicles: UserVehicle[],
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const FileSystem = (await import('expo-file-system/legacy' as string)) as LegacyFileSystem;
    const Sharing = (await import('expo-sharing' as string)) as SharingModule;
    const dir = FileSystem.documentDirectory ?? '';
    if (!dir) {
      logError({
        source: SOURCE,
        error: new Error('No document directory on this platform; the garage was not exported.'),
        severity: 'warning',
      });
      return null;
    }
    const uri = `${dir}${garageExportFileName(now)}`;
    await FileSystem.writeAsStringAsync(uri, garageExportJson(vehicles, now.getTime()));
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Share garage' });
    }
    return uri;
  } catch (e) {
    logError({ source: SOURCE, error: e, severity: 'warning' });
    return null;
  }
}
