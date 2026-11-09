/** The code book seen from the Adaptations screen (plan 22): which login code applies to a
 *  channel, and remembering / forgetting one. A garage car keeps its codes on its own record
 *  (`garageStore.update(id, { loginCodes })`); a registry car on a shadow entry in the login book
 *  (`bolid.loginBook`), keyed by `historyVehicleKey`. Nothing here touches `bolid.settings`. */
import { useGarageStore } from '@/shared/state/garageStore';
import { historyVehicleKey } from '@/shared/state/historyStore';
import {
  isUserVehicleId,
  loginCodeFor,
  removeLoginCode,
  upsertLoginCode,
  type AdaptationChannel,
  type HasLoginCodes,
  type LoginCodeEntry,
  type VehicleProfile,
} from '@/shared/vehicles';
import { useLoginBookStore } from '../model/loginBookStore';

/** Login-book keys for a registry car, primary first: the VIN key when the car reported one, then
 *  the profile-id key. */
export function loginBookKeys(profileId: string, vin: string | null | undefined): string[] {
  const idKey = historyVehicleKey({ id: profileId, label: '', vin: null });
  return vin ? [historyVehicleKey({ id: profileId, label: '', vin }), idKey] : [idKey];
}

/** The user's own code book for the active car: the garage record, or, for a registry car, the
 *  login book under its **primary** key only (`loginBookKeys(…)[0]`: the VIN key once the car
 *  reported a VIN, else the profile-id key). A code filed under the profile-id key while no VIN was
 *  known is not treated as this car's own once the VIN is known — any car on the same profile could
 *  have filed it, and sending another car's code burns an unlock attempt — see `preVinCodeBook`. */
export function userCodeBook(
  profile: VehicleProfile,
  vin: string | null | undefined,
  garage: { id: string; loginCodes?: LoginCodeEntry[] }[] = useGarageStore.getState().vehicles,
  book: Record<string, LoginCodeEntry[]> = useLoginBookStore.getState().byVehicle,
): HasLoginCodes | null {
  if (isUserVehicleId(profile.id)) return garage.find((v) => v.id === profile.id) ?? null;
  const codes = book[loginBookKeys(profile.id, vin)[0]];
  return codes?.length ? { loginCodes: codes } : null;
}

/** For a registry car that reported a VIN: the profile-id book — codes remembered before any VIN
 *  was known, possibly on another car of the same profile. Offered as a **pre-fill only** (the
 *  login sheet still opens and says where the code came from); never sent without the sheet and
 *  never forgotten by this car's rejection. Null for a garage car or when no VIN is known (the
 *  profile-id book is then the car's own, `userCodeBook`). */
export function preVinCodeBook(
  profile: VehicleProfile,
  vin: string | null | undefined,
  book: Record<string, LoginCodeEntry[]> = useLoginBookStore.getState().byVehicle,
): HasLoginCodes | null {
  if (isUserVehicleId(profile.id) || !vin) return null;
  const codes = book[loginBookKeys(profile.id, null)[0]];
  return codes?.length ? { loginCodes: codes } : null;
}

/** The code that applies to a login channel (user entry first, then the profile's), or null. */
export function loginFor(
  profile: VehicleProfile,
  user: HasLoginCodes | null,
  ch: AdaptationChannel,
): LoginCodeEntry | null {
  if (!ch.login || !ch.address) return null;
  return loginCodeFor(profile, user, ch.address);
}

/** Remember a code the user ticked "Remember for this car" for. */
export function rememberLoginCode(
  profile: VehicleProfile,
  vin: string | null | undefined,
  ch: AdaptationChannel,
  login: { code: number; wsc?: number },
): void {
  if (!ch.address) return;
  const entry: LoginCodeEntry = {
    address: ch.address,
    code: login.code,
    ...(login.wsc ? { wsc: login.wsc } : {}),
    purpose: ch.name,
    source: 'user-entered',
  };
  if (isUserVehicleId(profile.id)) {
    const garage = useGarageStore.getState();
    const car = garage.vehicles.find((v) => v.id === profile.id);
    if (car) garage.update(car.id, { loginCodes: upsertLoginCode(car.loginCodes, entry) });
    return;
  }
  useLoginBookStore.getState().remember(loginBookKeys(profile.id, vin)[0], entry);
}

/** Forget this car's remembered code for the channel's module: the garage record, or the login
 *  book's primary key for a registry car (the key `userCodeBook` reads). A pre-VIN code under the
 *  profile-id key is left alone once the VIN is known — it may belong to another car. */
export function forgetLoginCode(
  profile: VehicleProfile,
  vin: string | null | undefined,
  ch: AdaptationChannel,
): void {
  if (!ch.address) return;
  if (isUserVehicleId(profile.id)) {
    const garage = useGarageStore.getState();
    const car = garage.vehicles.find((v) => v.id === profile.id);
    if (car) {
      const rest = removeLoginCode(car.loginCodes, ch.address);
      garage.update(car.id, { loginCodes: rest.length ? rest : undefined });
    }
    return;
  }
  useLoginBookStore.getState().forget(loginBookKeys(profile.id, vin)[0], ch.address);
}
