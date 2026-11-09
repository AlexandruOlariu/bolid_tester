/** Validators for the exchange files (plan 13), built from the `validate.ts` combinators. Every
 *  object strips unknown keys (a newer app's additive fields never break this one), every list and
 *  record is capped, every string is length-bounded. See docs/exchange-formats.md. */
import { v, type ValidationResult, type Validator } from '../validate';
import { PROTOCOL_LABELS, type ProtocolId } from '../../obd-core/obd/protocols';
import type { Confirmation } from '../../obd-core/confirmation';
import type { DtcMake } from '../../obd-core/obd/dtcDatabase';
import {
  MAX_GROUP_DIDS,
  type AdaptationLabel,
  type CodingBitLabel,
  type MeasurementLabel,
  type MeasuringGroup,
} from '../../labels/types';
import type { DiagModule, Fuel } from '../../vehicles/types';
import {
  VEHICLE_NAME_MAX,
  VEHICLE_NOTES_MAX,
  sanitizeUserModules,
  type LearnedIdentity,
} from '../../vehicles/userVehicle';
import {
  EXCHANGE_APP_NAME,
  LABELPACK_SCHEMA_V1,
  PROFILE_SCHEMA_V1,
  type ExchangeEnvelope,
  type ExchangeVehicleV1,
  type LabelPackFileV1,
  type LabelPackV1,
  type ProfileFileV1,
  type ProfilePayloadV1,
} from './types';

/** List / record cap for every collection in an exchange file. */
export const MAX_ITEMS = 512;
/** Label packs a profile file may embed. */
export const MAX_EMBEDDED_PACKS = 20;

export const FUEL_VALUES = [
  'diesel',
  'petrol',
  'lpg',
  'hybrid',
  'other',
] as const satisfies readonly Fuel[];
// Compile-time check that FUEL_VALUES lists every Fuel.
const _allFuels: Record<Fuel, true> = {
  diesel: true,
  petrol: true,
  lpg: true,
  hybrid: true,
  other: true,
};
void _allFuels;

const MAKE_VALUES = ['vag', 'fiat', 'generic'] as const satisfies readonly DtcMake[];
const PROTOCOL_IDS = Object.keys(PROTOCOL_LABELS) as ProtocolId[];

/** Longest calibration id / adapter version string (the exporter clamps to it). */
export const MAX_IDENT_CHARS = 64;

/** Printable ASCII (space to `~`) — calibration ids, adapter versions. */
const PRINTABLE = /^[\x20-\x7E]*$/;
const DID_KEY = /^[0-9A-F]{4}$/;
const DID_DESC = 'a 4-digit uppercase hex DID';

const text = (max: number) => v.str({ max });
const name = (max = 120) => v.str({ min: 1, max });

/** `inner`, then `check` on the accepted value (null = fine, else the error message). */
function refine<T>(inner: Validator<T>, check: (value: T) => string | null): Validator<T> {
  return (x, path): ValidationResult<T> => {
    const r = inner(x, path);
    if (!r.ok) return r;
    const problem = check(r.value);
    return problem ? { ok: false, errors: [`${path || '/'}: ${problem}`] } : r;
  };
}

// --- label packs ---------------------------------------------------------------------------------

const confirmation = v.obj<Confirmation>({
  on: v.str({ pattern: /^\d{4}-\d{2}-\d{2}$/, desc: 'a date as YYYY-MM-DD' }),
  source: v.lit('sniffer-capture', 'on-car', 'vcds-log'),
  fixture: v.opt(text(200)),
  note: v.opt(text(500)),
});

const measurementLabel = v.obj<MeasurementLabel>({ name: name(), unit: v.opt(text(16)) });
const codingBitLabel = v.obj<CodingBitLabel>({
  byte: v.num({ int: true, min: 0, max: 255 }),
  bit: v.opt(v.num({ int: true, min: 0, max: 7 })),
  name: name(),
});
const adaptationLabel = v.obj<AdaptationLabel>({
  name: name(),
  unit: v.opt(text(16)),
  description: v.opt(text(500)),
});
const measuringGroup = v.obj<MeasuringGroup>({
  name: name(),
  dids: v.arr(v.hex(4), { max: MAX_GROUP_DIDS }),
  description: v.opt(text(500)),
});

/** A label pack — the payload of a `bolid.labelpack.v1` file, an embedded pack of a profile file,
 *  and each entry of the persisted `bolid.labelPacks` store. */
export const labelPackV1: Validator<LabelPackV1> = v.obj<LabelPackV1>({
  id: v.str({
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    desc: 'an id of letters, digits, ".", "_" or "-" (at most 64)',
  }),
  module: name(),
  partNumberPrefixes: v.arr(
    v.str({
      pattern: /^[0-9A-Z]{3,12}$/,
      desc: 'an uppercase part-number prefix (3-12 letters or digits, no spaces)',
    }),
    { min: 1, max: 32 },
  ),
  measurements: v.opt(v.rec(measurementLabel, DID_KEY, { max: MAX_ITEMS, keyDesc: DID_DESC })),
  codingBits: v.opt(
    v.rec(v.arr(codingBitLabel, { max: MAX_ITEMS }), DID_KEY, { max: 64, keyDesc: DID_DESC }),
  ),
  adaptations: v.opt(v.rec(adaptationLabel, DID_KEY, { max: MAX_ITEMS, keyDesc: DID_DESC })),
  measuringGroups: v.opt(
    v.rec(measuringGroup, /^[0-9]{1,3}$/, {
      max: MAX_ITEMS,
      keyDesc: 'a group number of 1-3 digits',
    }),
  ),
  author: v.opt(text(200)),
  source: v.opt(text(500)),
  license: v.opt(text(64)),
  confirmed: v.opt(confirmation),
});

// --- profiles ------------------------------------------------------------------------------------

const learnedIdentity = v.obj<LearnedIdentity>({
  protocol: v.lit(...PROTOCOL_IDS),
  supportedPids: v.arr(
    v.str({ pattern: /^01[0-9A-F]{2}$/, desc: 'a Mode 01 PID such as "010C"' }),
    { max: MAX_ITEMS },
  ),
  vin: v.nullable(
    v.str({ pattern: /^[A-Za-z0-9]{1,17}$/, desc: 'a VIN of up to 17 letters or digits' }),
  ),
  calibrationId: v.nullable(
    v.str({ max: MAX_IDENT_CHARS, pattern: PRINTABLE, desc: 'printable text' }),
  ),
  adapterVersion: v.opt(
    v.str({ max: MAX_IDENT_CHARS, pattern: PRINTABLE, desc: 'printable text' }),
  ),
  learnedAt: v.num({ int: true, min: 0 }),
});

type ExchangeModule = Pick<
  DiagModule,
  'address' | 'name' | 'transport' | 'reqHeader' | 'rxFilter' | 'tp20Address' | 'experimental'
>;
const HEX_ID = /^[0-9A-F]{3}(?:[0-9A-F]{5})?$/;
const canId = v.str({ pattern: HEX_ID, desc: 'an 11-bit (3 hex digits) or 29-bit (8) CAN id' });
const diagModule = refine(
  v.obj<ExchangeModule>({
    address: v.hex(2),
    name: name(),
    transport: v.lit('uds', 'tp20'),
    reqHeader: v.opt(canId),
    rxFilter: v.opt(canId),
    tp20Address: v.opt(v.num({ int: true, min: 0, max: 255 })),
    experimental: v.bool(),
  }),
  (m) =>
    sanitizeUserModules([m])
      ? null
      : m.transport === 'uds'
        ? 'a UDS module needs reqHeader and rxFilter'
        : 'a TP2.0 module needs tp20Address',
);

const exchangeVehicle = v.obj<ExchangeVehicleV1>({
  name: name(VEHICLE_NAME_MAX),
  year: v.opt(v.num({ int: true, min: 1950, max: 2100 })),
  fuel: v.lit(...FUEL_VALUES),
  make: v.opt(v.lit(...MAKE_VALUES)),
  baseProfileId: v.str({
    pattern: /^[a-z0-9][a-z0-9-]{0,63}$/,
    desc: 'a built-in profile id such as "golf-plus-2009-20tdi"',
  }),
  learned: v.opt(learnedIdentity),
  notes: v.opt(text(VEHICLE_NOTES_MAX)),
  modules: v.opt(v.arr(diagModule, { max: 64 })),
  sourceId: text(80),
});

const profilePayload = v.obj<ProfilePayloadV1>({
  vehicle: exchangeVehicle,
  labelPacks: v.opt(v.arr(labelPackV1, { max: MAX_EMBEDDED_PACKS })),
});

// --- envelopes -----------------------------------------------------------------------------------

function envelope<S extends string, T>(
  schema: S,
  payload: Validator<T>,
): Validator<ExchangeEnvelope<S, T>> {
  return v.obj<ExchangeEnvelope<S, T>>({
    schema: v.lit(schema),
    exportedAt: v.str({
      max: 40,
      pattern: /^\d{4}-\d{2}-\d{2}T/,
      desc: 'an ISO 8601 time',
    }),
    app: v.obj<ExchangeEnvelope<S, T>['app']>({
      name: v.lit(EXCHANGE_APP_NAME),
      version: text(32),
    }),
    payload,
  });
}

export const profileFileV1: Validator<ProfileFileV1> = envelope(PROFILE_SCHEMA_V1, profilePayload);
export const labelPackFileV1: Validator<LabelPackFileV1> = envelope(
  LABELPACK_SCHEMA_V1,
  labelPackV1,
);
