/** Share a label pack as a `bolid.labelpack.v1` file (plan 13) — an imported one, or a bundled one
 *  as a template to edit. The envelope is built by `shared/lib/exchange`; the file goes to the
 *  document directory and the OS share sheet. Every null is logged as a `settings/label-packs`
 *  warning. */
import {
  labelPackExportFile,
  loadExchangeModules,
  shareExchangeFile,
} from '@/shared/state/exchangeService';
import type { LabelPack } from '@/shared/labels';
import { translate } from '@/shared/i18n';

export const LABEL_PACKS_SOURCE = 'settings/label-packs';

/** Resolves with the file URI, or null when nothing was written. */
export async function shareLabelPackFile(
  pack: LabelPack,
  now: Date = new Date(),
): Promise<string | null> {
  const mods = await loadExchangeModules(LABEL_PACKS_SOURCE);
  if (!mods) return null;
  return shareExchangeFile(mods, labelPackExportFile(pack, now.getTime()), {
    source: LABEL_PACKS_SOURCE,
    title: translate('settings:packs.shareTitle', { module: pack.module }),
    now,
  });
}
