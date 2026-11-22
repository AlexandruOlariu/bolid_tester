/** A small, typed validator combinator set (plan 13) for **untrusted JSON**: imported profile and
 *  label-pack files today, seed/key plugin files (plan 23) next. Pure, no dependencies, no code
 *  generation — `ajv` compiles schemas with `new Function`, which Hermes does not support, and
 *  `zod` would add ~60 KB for a handful of schemas.
 *
 *  A validator never trusts its input: it reads only own properties, never the prototype chain,
 *  builds a **fresh** output value (so an accepted value holds nothing the schema did not name) and
 *  rejects the `__proto__` / `constructor` / `prototype` keys in records. Errors are JSON-pointer
 *  style: `/payload/vehicle/fuel: expected one of diesel|petrol|lpg|hybrid|other`. */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export type Validator<T> = (input: unknown, path: string) => ValidationResult<T>;

/** Keys a record may never carry (prototype pollution on a later assignment or spread). */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Stop collecting after this many errors (a huge broken file must not build a huge message). */
export const MAX_ERRORS = 50;

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = <T>(path: string, message: string): ValidationResult<T> => ({
  ok: false,
  errors: [`${path || '/'}: ${message}`],
});

/** JSON-pointer segment escaping (RFC 6901): `~` → `~0`, `/` → `~1`. */
function child(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function typeName(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Short, printable rendering of a rejected value for an error message. */
function show(x: unknown): string {
  if (typeof x === 'string') return JSON.stringify(x.length > 40 ? `${x.slice(0, 40)}…` : x);
  if (typeof x === 'number' || typeof x === 'boolean' || x === null) return String(x);
  return typeName(x);
}

function collect<T>(errors: string[], value: T): ValidationResult<T> {
  return errors.length ? { ok: false, errors: errors.slice(0, MAX_ERRORS) } : ok(value);
}

type ObjShape<T> = { [K in keyof T]-?: Validator<T[K]> };

export const v = {
  /** A string, optionally length-bounded and matching `pattern`; `desc` names the expected form
   *  in the error ("expected an uppercase part-number prefix"). */
  str(
    opts: { min?: number; max?: number; pattern?: RegExp; desc?: string } = {},
  ): Validator<string> {
    return (x, path) => {
      if (typeof x !== 'string') return fail(path, `expected a string, got ${typeName(x)}`);
      if (opts.min !== undefined && x.length < opts.min) {
        return fail(
          path,
          opts.min === 1 ? 'must not be empty' : `must be at least ${opts.min} characters`,
        );
      }
      if (opts.max !== undefined && x.length > opts.max) {
        return fail(path, `must be at most ${opts.max} characters`);
      }
      if (opts.pattern && !opts.pattern.test(x)) {
        return fail(
          path,
          `expected ${opts.desc ?? `a string matching ${String(opts.pattern)}`}, got ${show(x)}`,
        );
      }
      return ok(x);
    };
  },

  /** A finite number, optionally an integer within [min, max]. */
  num(opts: { int?: boolean; min?: number; max?: number } = {}): Validator<number> {
    return (x, path) => {
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        return fail(path, `expected a number, got ${show(x)}`);
      }
      if (opts.int && !Number.isInteger(x)) return fail(path, `expected a whole number, got ${x}`);
      if (opts.min !== undefined && x < opts.min) return fail(path, `must be at least ${opts.min}`);
      if (opts.max !== undefined && x > opts.max) return fail(path, `must be at most ${opts.max}`);
      return ok(x);
    };
  },

  bool(): Validator<boolean> {
    return (x, path) =>
      typeof x === 'boolean' ? ok(x) : fail(path, `expected true or false, got ${show(x)}`);
  },

  /** One of a fixed set of strings. */
  lit<L extends string>(...values: L[]): Validator<L> {
    return (x, path) =>
      typeof x === 'string' && (values as string[]).includes(x)
        ? ok(x as L)
        : fail(path, `expected one of ${values.join('|')}, got ${show(x)}`);
  },

  /** `inner`, or absent (`undefined`). In an `obj`, an absent optional key stays absent. */
  opt<T>(inner: Validator<T>): Validator<T | undefined> {
    return (x, path) => (x === undefined ? ok(undefined) : inner(x, path));
  },

  /** `inner`, or `null`. */
  nullable<T>(inner: Validator<T>): Validator<T | null> {
    return (x, path) => (x === null ? ok(null) : inner(x, path));
  },

  /** An array of `inner`, at most `max` (and at least `min`) items. */
  arr<T>(inner: Validator<T>, opts: { min?: number; max?: number } = {}): Validator<T[]> {
    return (x, path) => {
      if (!Array.isArray(x)) return fail(path, `expected a list, got ${typeName(x)}`);
      if (opts.max !== undefined && x.length > opts.max) {
        return fail(path, `at most ${opts.max} items allowed, got ${x.length}`);
      }
      if (opts.min !== undefined && x.length < opts.min) {
        return fail(
          path,
          opts.min === 1 ? 'must not be empty' : `at least ${opts.min} items required`,
        );
      }
      const out: T[] = [];
      const errors: string[] = [];
      for (let i = 0; i < x.length && errors.length < MAX_ERRORS; i++) {
        const r = inner(x[i], child(path, i));
        if (r.ok) out.push(r.value);
        else errors.push(...r.errors);
      }
      return collect(errors, out);
    };
  },

  /** A string-keyed record of `inner`; every key must match `keyPattern` (when given) and none may
   *  be `__proto__` / `constructor` / `prototype`. `keyDesc` names the key form in errors. */
  rec<T>(
    inner: Validator<T>,
    keyPattern?: RegExp,
    opts: { max?: number; keyDesc?: string } = {},
  ): Validator<Record<string, T>> {
    return (x, path) => {
      if (!isPlainObject(x)) return fail(path, `expected an object, got ${typeName(x)}`);
      const keys = Object.keys(x);
      if (opts.max !== undefined && keys.length > opts.max) {
        return fail(path, `at most ${opts.max} entries allowed, got ${keys.length}`);
      }
      const out: Record<string, T> = {};
      const errors: string[] = [];
      for (const k of keys) {
        if (errors.length >= MAX_ERRORS) break;
        if (RESERVED_KEYS.has(k)) {
          errors.push(`${path || '/'}: key ${show(k)} is not allowed`);
          continue;
        }
        if (keyPattern && !keyPattern.test(k)) {
          const desc = opts.keyDesc ?? `a key matching ${String(keyPattern)}`;
          errors.push(`${path || '/'}: key ${show(k)} is not ${desc}`);
          continue;
        }
        const r = inner(x[k], child(path, k));
        if (r.ok) out[k] = r.value;
        else errors.push(...r.errors);
      }
      return collect(errors, out);
    };
  },

  /** An object with exactly the `shape` keys. Unknown keys are dropped (`extra: 'strip'`, the
   *  default — a newer app's additive fields never break an older one) or rejected
   *  (`extra: 'reject'`). A required key that is missing reports "is required"; an optional key
   *  that is absent stays absent in the output. */
  obj<T>(shape: ObjShape<T>, opts: { extra?: 'strip' | 'reject' } = {}): Validator<T> {
    const known = Object.keys(shape);
    return (x, path) => {
      if (!isPlainObject(x)) return fail(path, `expected an object, got ${typeName(x)}`);
      const out: Record<string, unknown> = {};
      const errors: string[] = [];
      for (const k of known) {
        if (errors.length >= MAX_ERRORS) break;
        const validator = (shape as Record<string, Validator<unknown>>)[k];
        const present = hasOwn(x, k);
        const r = validator(present ? x[k] : undefined, child(path, k));
        if (r.ok) {
          if (r.value !== undefined) out[k] = r.value;
        } else if (!present) {
          errors.push(`${child(path, k)}: is required`);
        } else {
          errors.push(...r.errors);
        }
      }
      if (opts.extra === 'reject') {
        for (const k of Object.keys(x)) {
          if (!known.includes(k)) errors.push(`${child(path, k)}: unknown field`);
        }
      }
      return collect(errors, out as T);
    };
  },

  /** Uppercase hex of exactly `len` digits, e.g. a DID `'1701'` (`hex(4)`). */
  hex(len: number): Validator<string> {
    const re = new RegExp(`^[0-9A-F]{${len}}$`);
    return (x, path) => {
      if (typeof x !== 'string') return fail(path, `expected a string, got ${typeName(x)}`);
      return re.test(x)
        ? ok(x)
        : fail(path, `expected ${len} uppercase hex digits (0-9, A-F), got ${show(x)}`);
    };
  },
};

/** Run `schema` over `input` from the document root. */
export function validate<T>(schema: Validator<T>, input: unknown): ValidationResult<T> {
  return schema(input, '');
}
