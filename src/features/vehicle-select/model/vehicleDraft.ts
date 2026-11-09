/** The garage editor's form model (plan 06): a text-only draft, its validation and the conversion
 *  to a garage record. Pure, so the rules are unit-tested without rendering the sheet. */
import {
  VEHICLE_NAME_MAX,
  VEHICLE_NOTES_MAX,
  VEHICLE_REGISTRY,
  type Fuel,
  type UserVehicle,
} from '@/shared/vehicles';
import type { NewUserVehicle } from '@/shared/state/garageStore';

export const FUELS: { value: Fuel; label: string }[] = [
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'lpg', label: 'LPG' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'other', label: 'Other' },
];

export interface VehicleDraft {
  name: string;
  /** Free text from the numeric field; blank = unknown. */
  year: string;
  fuel: Fuel;
  baseProfileId: string;
  notes: string;
}

export const MIN_YEAR = 1980;

export function emptyDraft(): VehicleDraft {
  return { name: '', year: '', fuel: 'petrol', baseProfileId: 'generic', notes: '' };
}

export function draftFromVehicle(v: UserVehicle): VehicleDraft {
  return {
    name: v.name,
    year: v.year ? String(v.year) : '',
    fuel: v.fuel,
    baseProfileId: v.baseProfileId,
    notes: v.notes ?? '',
  };
}

/** Field errors in plain English; empty when the draft can be saved. */
export function validateDraft(
  d: VehicleDraft,
  now: Date = new Date(),
): Partial<Record<keyof VehicleDraft, string>> {
  const errors: Partial<Record<keyof VehicleDraft, string>> = {};
  if (!d.name.trim()) errors.name = 'Give the car a name, e.g. "Dacia Logan 2015".';
  else if (d.name.trim().length > VEHICLE_NAME_MAX)
    errors.name = `Keep the name to ${VEHICLE_NAME_MAX} characters or fewer.`;
  if (d.notes.trim().length > VEHICLE_NOTES_MAX)
    errors.notes = `Keep the notes to ${VEHICLE_NOTES_MAX} characters or fewer.`;
  const y = d.year.trim();
  if (y) {
    const n = Number(y);
    const max = now.getFullYear() + 1;
    if (!/^\d{4}$/.test(y) || n < MIN_YEAR || n > max)
      errors.year = `Year must be between ${MIN_YEAR} and ${max}, or left blank.`;
  }
  if (!VEHICLE_REGISTRY[d.baseProfileId]) errors.baseProfileId = 'Pick a base profile.';
  return errors;
}

/** The garage fields a valid draft sets (identity and learned data are kept by the store). */
export function draftToVehicle(
  d: VehicleDraft,
): Pick<NewUserVehicle, 'name' | 'year' | 'fuel' | 'baseProfileId' | 'notes'> {
  const year = d.year.trim() ? Number(d.year.trim()) : undefined;
  const notes = d.notes.trim();
  return {
    name: d.name.trim(),
    year,
    fuel: d.fuel,
    baseProfileId: d.baseProfileId,
    notes: notes || undefined,
  };
}
