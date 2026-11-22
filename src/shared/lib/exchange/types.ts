/** Exchange file formats (plan 13): a garage car ("profile") or a label pack as a versioned JSON
 *  envelope that travels between phones or comes from a community repo. Pure data — `decode`
 *  functions are code and are never exported; a car carries only its learned identity and the id
 *  of the built-in profile it inherits from. See docs/exchange-formats.md. */
import type { Confirmation } from '../../obd-core/confirmation';
import type { LabelPack } from '../../labels/types';
import type { UserVehicle } from '../../vehicles/userVehicle';

export const PROFILE_SCHEMA_V1 = 'bolid.profile.v1';
export const LABELPACK_SCHEMA_V1 = 'bolid.labelpack.v1';
export const EXCHANGE_APP_NAME = 'bolid-tester' as const;

export interface ExchangeEnvelope<S extends string, T> {
  schema: S;
  /** ISO 8601 time of the export. */
  exportedAt: string;
  app: { name: typeof EXCHANGE_APP_NAME; version: string };
  payload: T;
}

/** A garage car without its phone-local identity. The code book (`loginCodes`) is never part of a
 *  profile file — module login codes stay on the phone that learned them (they still travel in a
 *  full backup, plan 18). */
export type ExchangeVehicleV1 = Omit<
  UserVehicle,
  'id' | 'createdAt' | 'updatedAt' | 'loginCodes'
> & {
  /** The exporting phone's id for this car (`user:…`), or the registry id of a seed. */
  sourceId: string;
};

export interface ProfilePayloadV1 {
  vehicle: ExchangeVehicleV1;
  /** Label packs the exporting phone had imported for this car's modules (optional, embedded). */
  labelPacks?: LabelPackV1[];
}

export interface LabelPackV1 extends LabelPack {
  author?: string;
  /** URL or free text. */
  source?: string;
  /** SPDX id, e.g. 'CC0-1.0'. */
  license?: string;
  /** Set when the pack was verified on a car (plan 25 `Confirmation`). */
  confirmed?: Confirmation;
}

export type ProfileFileV1 = ExchangeEnvelope<typeof PROFILE_SCHEMA_V1, ProfilePayloadV1>;
export type LabelPackFileV1 = ExchangeEnvelope<typeof LABELPACK_SCHEMA_V1, LabelPackV1>;
