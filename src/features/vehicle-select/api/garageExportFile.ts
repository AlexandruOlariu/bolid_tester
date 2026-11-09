/** **Share garage as JSON** (plan 06): save the garage as `bolid-garage-<stamp>.json` through
 *  `saveTextFile` (plan 28) — the app's document directory + the OS share sheet on native (legacy
 *  file-system entry point: the root `expo-file-system` has no `documentDirectory` on this SDK), a
 *  browser download on web. A platform with neither degrades to a logged warning, never a crash.
 *  Import is plan 13. */
import { garageExportJson } from '@/shared/state/garageStore';
import { logError } from '@/shared/state/errorLogStore';
import { saveTextFile } from '@/shared/lib/saveFile';
import type { UserVehicle } from '@/shared/vehicles';
import { translate } from '@/shared/i18n';

const SOURCE = 'vehicle-select/export';

/** `bolid-garage-<ISO stamp with : and . replaced>.json`. Pure. */
export function garageExportFileName(now: Date = new Date()): string {
  return `bolid-garage-${now.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** Resolves with the written file URI (native) or the downloaded file name (web), or null when nothing was written. Every null is logged as a
 *  `vehicle-select/export` warning, including the "no document directory" case. */
export async function saveGarageExport(
  vehicles: UserVehicle[],
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const uri = await saveTextFile(
      garageExportFileName(now),
      garageExportJson(vehicles, now.getTime()),
      'application/json',
      { dialogTitle: translate('vehicleSelect:editor.shareDialog') },
    );
    if (!uri) {
      logError({
        source: SOURCE,
        error: new Error('No document directory on this platform; the garage was not exported.'),
        severity: 'warning',
      });
      return null;
    }
    return uri;
  } catch (e) {
    logError({ source: SOURCE, error: e, severity: 'warning' });
    return null;
  }
}
