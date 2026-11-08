/** Write a replay fixture (built by `model/replayExport.ts`) to the app's document directory and
 *  open the share sheet. Uses the legacy file-system entry point: on this Expo SDK the root
 *  `expo-file-system` has no `documentDirectory` and throws for `writeAsStringAsync` (same as the
 *  sniffer's `captureExport.ts`). Native modules load with a variable specifier so a platform
 *  without them (web) degrades to a logged warning instead of a crash. */
import { logError } from '@/shared/state/errorLogStore';
import { buildReplayExport, ReplayExportInput } from '../model/replayExport';

interface LegacyFileSystem {
  documentDirectory?: string | null;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
}
interface SharingModule {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void>;
}

const SOURCE = 'settings/replay-export';

/** Resolves with the saved file name, or null when nothing was written. Every null is logged, so
 *  the Settings copy ("See More → Error log") always has an entry to point at. */
export async function saveReplayFixture(input: ReplayExportInput): Promise<string | null> {
  try {
    const FileSystem = (await import('expo-file-system/legacy' as string)) as LegacyFileSystem;
    const Sharing = (await import('expo-sharing' as string)) as SharingModule;
    const dir = FileSystem.documentDirectory ?? '';
    if (!dir) {
      logError({
        source: SOURCE,
        error: new Error('No document directory on this platform; the fixture was not saved.'),
        severity: 'warning',
      });
      return null;
    }
    const { fileName, fixture } = buildReplayExport(input);
    const uri = `${dir}${fileName}`;
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(fixture, null, 2));
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Share replay fixture',
      });
    }
    return fileName;
  } catch (e) {
    logError({ source: SOURCE, error: e, severity: 'warning' });
    return null;
  }
}
