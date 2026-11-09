/** Save a replay fixture (built by `model/replayExport.ts`): on native, written to the document
 *  directory (legacy file-system entry point — the root `expo-file-system` has no
 *  `documentDirectory` on this SDK) and handed to the share sheet; on web, downloaded by the browser
 *  (`saveTextFile`, plan 28). A platform with neither degrades to a logged warning, never a crash. */
import { logError } from '@/shared/state/errorLogStore';
import { saveTextFile } from '@/shared/lib/saveFile';
import { buildReplayExport, ReplayExportInput } from '../model/replayExport';

const SOURCE = 'settings/replay-export';

/** Resolves with the saved file name, or null when nothing was written. Every null is logged, so
 *  the Settings copy ("See More → Error log") always has an entry to point at. */
export async function saveReplayFixture(input: ReplayExportInput): Promise<string | null> {
  try {
    const { fileName, fixture } = buildReplayExport(input);
    const saved = await saveTextFile(
      fileName,
      JSON.stringify(fixture, null, 2),
      'application/json',
      { dialogTitle: 'Share replay fixture' },
    );
    if (!saved) {
      logError({
        source: SOURCE,
        error: new Error('No document directory on this platform; the fixture was not saved.'),
        severity: 'warning',
      });
      return null;
    }
    return fileName;
  } catch (e) {
    logError({ source: SOURCE, error: e, severity: 'warning' });
    return null;
  }
}
