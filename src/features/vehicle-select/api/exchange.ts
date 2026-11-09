/** Share a car as a `bolid.profile.v1` file (plan 13): a garage car with its learned identity (and
 *  the imported label packs for its modules), or a built-in profile as a **seed** a friend learns
 *  their own car from. The envelope is built by `shared/lib/exchange` (pure); the file goes to the
 *  document directory and the OS share sheet through `shareExchangeFile`. Every null is logged as a
 *  `vehicle-select/exchange` warning. Import lives in `shared/ui/useExchangeImport`. */
import {
  loadExchangeModules,
  profileSeedFile,
  shareExchangeFile,
  vehicleExportFile,
} from '@/shared/state/exchangeService';
import type { UserVehicle, VehicleProfile } from '@/shared/vehicles';
import { translate } from '@/shared/i18n';

export const EXCHANGE_SOURCE = 'vehicle-select/exchange';

/** Export garage car `user`; resolves with the file URI, or null when nothing was written. */
export async function shareVehicleFile(
  user: UserVehicle,
  now: Date = new Date(),
): Promise<string | null> {
  const mods = await loadExchangeModules(EXCHANGE_SOURCE);
  if (!mods) return null;
  return shareExchangeFile(mods, vehicleExportFile(user, now.getTime()), {
    source: EXCHANGE_SOURCE,
    title: translate('vehicleSelect:shareTitle', { name: user.name }),
    now,
  });
}

/** Export built-in profile `profile` as a seed (no learned identity). */
export async function shareProfileSeedFile(
  profile: VehicleProfile,
  now: Date = new Date(),
): Promise<string | null> {
  const mods = await loadExchangeModules(EXCHANGE_SOURCE);
  if (!mods) return null;
  return shareExchangeFile(mods, profileSeedFile(profile, now.getTime()), {
    source: EXCHANGE_SOURCE,
    title: translate('vehicleSelect:shareTitle', { name: profile.name }),
    now,
  });
}
