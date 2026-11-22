/** `bolid.seedkey.v1` — a user-supplied security-access plugin file (plan 23): validate an
 *  untrusted file with the plan-13 combinators, then compile its program with the bounded DSL
 *  (`obd-core/coding/seedKeyDsl`) so a file over the limits is refused at import with a readable
 *  message. The text is only `JSON.parse`d — nothing in it is evaluated — and the validator
 *  rebuilds the value, so only fields the schema names are kept. The app ships no plugin.
 *  See docs/exchange-formats.md → `bolid.seedkey.v1`. */
import { v, validate, type ValidationResult, type Validator } from '../validate';
import { utf8Bytes } from '../backup';
import {
  SEED_KEY_LIMITS,
  SEED_KEY_SCHEMA_V1,
  SeedKeyError,
  compileSeedKey,
  countSeedKeyOps,
  type SeedKeyOp,
  type SeedKeyPluginV1,
} from '../../obd-core/coding/seedKeyDsl';

/** Largest plugin file the app reads. A 256-op program with a few 256-entry tables fits easily. */
export const MAX_SEED_KEY_BYTES = 200_000;
/** Plugins kept on the phone. */
export const MAX_SEED_KEY_PLUGINS = 50;

const u32 = v.num({ int: true, min: 0, max: 0xffffffff });

/** `inner`, then `check` on the accepted value (null = fine, else the error message). */
function refine<T>(inner: Validator<T>, check: (value: T) => string | null): Validator<T> {
  return (x, path): ValidationResult<T> => {
    const r = inner(x, path);
    if (!r.ok) return r;
    const problem = check(r.value);
    return problem ? { ok: false, errors: [`${path || '/'}: ${problem}`] } : r;
  };
}

const width = refine(v.num({ int: true }), (n) => (n === 2 || n === 4 ? null : 'must be 2 or 4'));

/** One DSL op at nesting `depth` (0 = top level). Dispatches on `op`; unknown fields are stripped;
 *  a repeat deeper than the limit is refused here as well as by the compiler. */
function seedKeyOp(depth: number): Validator<SeedKeyOp> {
  const head = v.obj<{ op: string }>({ op: v.str({ max: 16 }) });
  const byOp: Record<string, () => Validator<SeedKeyOp>> = {
    load: () => v.obj({ op: v.lit('load'), from: v.lit('seed') }),
    const: () => v.obj({ op: v.lit('const'), value: u32 }),
    add: () => v.obj({ op: v.lit('add'), value: u32 }),
    sub: () => v.obj({ op: v.lit('sub'), value: u32 }),
    mul: () => v.obj({ op: v.lit('mul'), value: u32 }),
    xor: () => v.obj({ op: v.lit('xor'), value: u32 }),
    and: () => v.obj({ op: v.lit('and'), value: u32 }),
    or: () => v.obj({ op: v.lit('or'), value: u32 }),
    not: () => v.obj({ op: v.lit('not') }),
    swap16: () => v.obj({ op: v.lit('swap16') }),
    bswap: () => v.obj({ op: v.lit('bswap') }),
    shl: () => v.obj({ op: v.lit('shl'), bits: v.num({ int: true, min: 0, max: 31 }) }),
    shr: () => v.obj({ op: v.lit('shr'), bits: v.num({ int: true, min: 0, max: 31 }) }),
    rol: () => v.obj({ op: v.lit('rol'), bits: v.num({ int: true, min: 0, max: 31 }) }),
    ror: () => v.obj({ op: v.lit('ror'), bits: v.num({ int: true, min: 0, max: 31 }) }),
    mask: () =>
      v.obj({
        op: v.lit('mask'),
        bits: refine(v.num({ int: true }), (n) =>
          n === 8 || n === 16 || n === 32 ? null : 'must be 8, 16 or 32',
        ) as Validator<8 | 16 | 32>,
      }),
    table: () =>
      v.obj({
        op: v.lit('table'),
        values: refine(v.arr(u32, { max: 256 }), (a) =>
          a.length === 256 ? null : `needs exactly 256 values, got ${a.length}`,
        ),
        index: v.lit('low8'),
      }),
    repeat: () =>
      v.obj({
        op: v.lit('repeat'),
        count: v.num({ int: true, min: 0, max: SEED_KEY_LIMITS.maxRepeat }),
        body: v.arr(seedKeyOp(depth + 1), { max: SEED_KEY_LIMITS.maxBody }),
      }),
    store: () => v.obj({ op: v.lit('store') }),
  };
  return (x, path) => {
    const h = head(x, path);
    if (!h.ok) return h;
    const make = Object.prototype.hasOwnProperty.call(byOp, h.value.op) ? byOp[h.value.op] : null;
    if (!make) {
      return { ok: false, errors: [`${path}/op: unknown operation ${JSON.stringify(h.value.op)}`] };
    }
    if (h.value.op === 'repeat' && depth >= SEED_KEY_LIMITS.maxNesting) {
      return {
        ok: false,
        errors: [`${path}: repeats may nest at most ${SEED_KEY_LIMITS.maxNesting} deep`],
      };
    }
    return make()(x, path);
  };
}

type Applies = SeedKeyPluginV1['applies'];

const applies = refine(
  v.obj<Applies>({
    reqHeader: v.opt(
      v.str({
        pattern: /^[0-9A-F]{3}(?:[0-9A-F]{5})?$/,
        desc: 'an 11-bit (3 hex digits) or 29-bit (8) CAN id in uppercase',
      }),
    ),
    address: v.opt(v.hex(2)),
    level: refine(v.num({ int: true, min: 1, max: 0x7d }), (n) =>
      n % 2 === 1 ? null : 'must be an odd requestSeed level (0x01, 0x03, …)',
    ),
    partNumberPrefix: v.opt(
      v.str({
        pattern: /^[0-9A-Z]{3,12}$/,
        desc: 'an uppercase part-number prefix (3-12 letters or digits, no spaces)',
      }),
    ),
  }),
  (a) =>
    a.reqHeader || a.address || a.partNumberPrefix
      ? null
      : 'name the module it applies to: reqHeader, address or partNumberPrefix',
);

/** The whole plugin file; the program is also compiled, so a file over the DSL limits fails here
 *  with the compiler's message. */
export const seedKeyPluginV1: Validator<SeedKeyPluginV1> = refine(
  v.obj<SeedKeyPluginV1>({
    schema: v.lit(SEED_KEY_SCHEMA_V1),
    name: v.str({ min: 1, max: 80 }),
    applies,
    seedBytes: width as Validator<2 | 4>,
    keyBytes: width as Validator<2 | 4>,
    program: v.arr(seedKeyOp(0), { min: 1, max: SEED_KEY_LIMITS.maxOps }),
    notes: v.opt(v.str({ max: 2000 })),
  }),
  (p) => {
    try {
      compileSeedKey(p);
      return null;
    } catch (e) {
      return e instanceof SeedKeyError ? e.message : 'the program could not be compiled';
    }
  },
);

export type SeedKeyParse =
  | { ok: true; plugin: SeedKeyPluginV1; opCount: number; steps: number }
  | { ok: false; error: string; details: string[] };

/** JSON parse → schema → compile. A refused file gets a one-line reason plus the validator's
 *  errors (the UI shows the first three). */
export function parseSeedKeyFile(text: string): SeedKeyParse {
  if (text.length > MAX_SEED_KEY_BYTES || utf8Bytes(text) > MAX_SEED_KEY_BYTES) {
    return {
      ok: false,
      error: 'This file is too large for a security-access plugin.',
      details: [],
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'This file is not valid JSON.', details: [] };
  }
  const schema =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as { schema?: unknown }).schema
      : undefined;
  if (schema !== SEED_KEY_SCHEMA_V1) {
    const newer = typeof schema === 'string' && /^bolid\.seedkey\.v([2-9]|\d{2,})$/.test(schema);
    return {
      ok: false,
      error: newer
        ? `This plugin uses format ${schema}, made by a newer version of the app. Update the app to import it.`
        : `This is not a security-access plugin (expected "schema": "${SEED_KEY_SCHEMA_V1}").`,
      details: [],
    };
  }
  const r = validate(seedKeyPluginV1, data);
  if (!r.ok) {
    const overLimit = r.errors.some((e) => /limit|nest at most|at most \d+ items/.test(e));
    return {
      ok: false,
      error: overLimit
        ? 'This plugin is over the safety limits for a seed→key program.'
        : 'This security-access plugin is not valid.',
      details: r.errors,
    };
  }
  const compiled = compileSeedKey(r.value);
  return {
    ok: true,
    plugin: r.value,
    opCount: countSeedKeyOps(r.value.program),
    steps: compiled.steps,
  };
}
