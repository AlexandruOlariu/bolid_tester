/** Seed→key plugins (plan 23): a tiny, bounded, data-only program over one 32-bit accumulator that
 *  turns a SecurityAccess (`27`) seed into a key. The owner supplies the program for their own car
 *  as a `bolid.seedkey.v1` file; the app ships, downloads and derives **none**.
 *
 *  Why a DSL and not JavaScript: Hermes has no `eval` / `new Function`, so a script would not run on
 *  the phone at all; a data program cannot reach the file system, the network, the stores or the
 *  session (its only input is the seed, its only output is the key); execution is bounded
 *  (`SEED_KEY_LIMITS.maxSteps`, checked before the first op runs — the program has no branches, so
 *  its step count is known up front); and it is diffable and unit-testable. The op set is generic
 *  32-bit arithmetic and encodes no manufacturer knowledge. Pure, zero dependencies.
 *  See docs/exchange-formats.md → `bolid.seedkey.v1`. */

export const SEED_KEY_SCHEMA_V1 = 'bolid.seedkey.v1';

export type SeedKeyArithOp = 'add' | 'sub' | 'mul' | 'xor' | 'and' | 'or';
export type SeedKeyShiftOp = 'shl' | 'shr' | 'rol' | 'ror';

/** One operation. `acc` is an unsigned 32-bit accumulator; every result wraps modulo 2^32. */
export type SeedKeyOp =
  /** acc = the seed as a big-endian unsigned number. */
  | { op: 'load'; from: 'seed' }
  /** acc = value. */
  | { op: 'const'; value: number }
  /** acc = acc <op> value (add / sub / mul wrap modulo 2^32). */
  | { op: SeedKeyArithOp; value: number }
  /** acc = ~acc. */
  | { op: 'not' }
  /** Exchange the high and low 16-bit halves (0xAABBCCDD → 0xCCDDAABB). */
  | { op: 'swap16' }
  /** Reverse the four bytes (0xAABBCCDD → 0xDDCCBBAA). */
  | { op: 'bswap' }
  /** Shift / rotate by 0–31 bits. */
  | { op: SeedKeyShiftOp; bits: number }
  /** Keep the low 8, 16 or 32 bits. */
  | { op: 'mask'; bits: 8 | 16 | 32 }
  /** acc = values[acc & 0xff]; exactly 256 entries. */
  | { op: 'table'; values: number[]; index: 'low8' }
  /** Run `body` `count` times (count ≤ 64, body ≤ 32 ops, repeats nest at most 2 deep). */
  | { op: 'repeat'; count: number; body: SeedKeyOp[] }
  /** key = acc truncated to `keyBytes` (big-endian). The last `store` wins. */
  | { op: 'store' };

/** A user-supplied seed→key plugin file. */
export interface SeedKeyPluginV1 {
  schema: typeof SEED_KEY_SCHEMA_V1;
  /** Display name, e.g. 'My Golf BCM level 03'. */
  name: string;
  /** Scope: which module(s) and SecurityAccess level the routine applies to. At least one of
   *  `reqHeader`, `address` or `partNumberPrefix` names the module. */
  applies: { reqHeader?: string; address?: string; level: number; partNumberPrefix?: string };
  /** Seed / key byte widths the module uses. */
  seedBytes: 2 | 4;
  keyBytes: 2 | 4;
  program: SeedKeyOp[];
  notes?: string;
}

/** A compiled routine: seed bytes in, key bytes out. Throws `SeedKeyError` on a seed of the wrong
 *  width. `steps` is the exact number of ops one run executes. */
export interface CompiledSeedKey {
  (seed: number[]): number[];
  readonly steps: number;
}

export const SEED_KEY_LIMITS = {
  /** Ops written in the program, counting every nested op. */
  maxOps: 256,
  /** Ops executed in one run (a repeat's body counts once per iteration). */
  maxSteps: 4096,
  /** Repeats inside repeats, at most this deep. */
  maxNesting: 2,
  /** Iterations of one repeat. */
  maxRepeat: 64,
  /** Ops directly inside one repeat body. */
  maxBody: 32,
} as const;

export class SeedKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedKeyError';
  }
}

const ARITH = new Set<string>(['add', 'sub', 'mul', 'xor', 'and', 'or']);
const SHIFT = new Set<string>(['shl', 'shr', 'rol', 'ror']);

const isUint32 = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

/** Validate one op list (recursively) and return its exact executed step count and written op
 *  count. Throws `SeedKeyError` naming the op by its path (`program[3].body[0]`). */
function analyse(
  ops: unknown,
  path: string,
  depth: number,
  totals: { ops: number },
): { steps: number; stores: boolean } {
  if (!Array.isArray(ops)) throw new SeedKeyError(`${path}: expected a list of operations`);
  let steps = 0;
  let stores = false;
  ops.forEach((raw, i) => {
    const at = `${path}[${i}]`;
    totals.ops++;
    if (totals.ops > SEED_KEY_LIMITS.maxOps) {
      throw new SeedKeyError(
        `The program has more than ${SEED_KEY_LIMITS.maxOps} operations (the limit).`,
      );
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SeedKeyError(`${at}: expected an operation object`);
    }
    const o = raw as Record<string, unknown>;
    const op = o.op;
    steps++;
    if (op === 'load') {
      if (o.from !== 'seed') throw new SeedKeyError(`${at}: load needs from: "seed"`);
    } else if (op === 'const' || (typeof op === 'string' && ARITH.has(op))) {
      if (!isUint32(o.value)) {
        throw new SeedKeyError(`${at}: ${op} needs a whole number value from 0 to 4294967295`);
      }
    } else if (op === 'not' || op === 'swap16' || op === 'bswap') {
      // no operands
    } else if (typeof op === 'string' && SHIFT.has(op)) {
      if (typeof o.bits !== 'number' || !Number.isInteger(o.bits) || o.bits < 0 || o.bits > 31) {
        throw new SeedKeyError(`${at}: ${op} needs bits from 0 to 31`);
      }
    } else if (op === 'mask') {
      if (o.bits !== 8 && o.bits !== 16 && o.bits !== 32) {
        throw new SeedKeyError(`${at}: mask needs bits 8, 16 or 32`);
      }
    } else if (op === 'table') {
      if (o.index !== 'low8') throw new SeedKeyError(`${at}: table needs index: "low8"`);
      if (!Array.isArray(o.values) || o.values.length !== 256) {
        throw new SeedKeyError(`${at}: table needs exactly 256 values`);
      }
      if (!o.values.every(isUint32)) {
        throw new SeedKeyError(`${at}: every table value must be a whole number 0–4294967295`);
      }
    } else if (op === 'repeat') {
      if (depth >= SEED_KEY_LIMITS.maxNesting) {
        throw new SeedKeyError(
          `${at}: repeats may nest at most ${SEED_KEY_LIMITS.maxNesting} deep`,
        );
      }
      const count = o.count;
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > SEED_KEY_LIMITS.maxRepeat
      ) {
        throw new SeedKeyError(`${at}: repeat count must be 0–${SEED_KEY_LIMITS.maxRepeat}`);
      }
      if (!Array.isArray(o.body) || o.body.length > SEED_KEY_LIMITS.maxBody) {
        throw new SeedKeyError(
          `${at}: a repeat body holds at most ${SEED_KEY_LIMITS.maxBody} operations`,
        );
      }
      const inner = analyse(o.body, `${at}.body`, depth + 1, totals);
      steps += count * inner.steps;
      if (count > 0 && inner.stores) stores = true;
    } else if (op === 'store') {
      stores = true;
    } else {
      throw new SeedKeyError(`${at}: unknown operation ${JSON.stringify(op)}`);
    }
    if (steps > SEED_KEY_LIMITS.maxSteps) {
      throw new SeedKeyError(
        `The program would run more than ${SEED_KEY_LIMITS.maxSteps} steps (the limit).`,
      );
    }
  });
  return { steps, stores };
}

const rol = (x: number, n: number) => (n === 0 ? x >>> 0 : ((x << n) | (x >>> (32 - n))) >>> 0);

/** Run `ops` once. `state.acc` / `state.key` are updated in place; `budget` guards the step count
 *  (already proven ≤ maxSteps by `analyse`; kept as a second line of defence). */
function run(
  ops: SeedKeyOp[],
  state: { acc: number; key: number | null; seed: number; budget: number },
): void {
  for (const o of ops) {
    if (--state.budget < 0) throw new SeedKeyError('Step limit exceeded.');
    switch (o.op) {
      case 'load':
        state.acc = state.seed;
        break;
      case 'const':
        state.acc = o.value >>> 0;
        break;
      case 'add':
        state.acc = (state.acc + o.value) >>> 0;
        break;
      case 'sub':
        state.acc = (state.acc - o.value) >>> 0;
        break;
      case 'mul':
        state.acc = Math.imul(state.acc, o.value) >>> 0;
        break;
      case 'xor':
        state.acc = (state.acc ^ o.value) >>> 0;
        break;
      case 'and':
        state.acc = (state.acc & o.value) >>> 0;
        break;
      case 'or':
        state.acc = (state.acc | o.value) >>> 0;
        break;
      case 'not':
        state.acc = ~state.acc >>> 0;
        break;
      case 'swap16':
        state.acc = rol(state.acc, 16);
        break;
      case 'bswap': {
        const a = state.acc;
        state.acc =
          (((a & 0xff) << 24) | ((a & 0xff00) << 8) | ((a >>> 8) & 0xff00) | (a >>> 24)) >>> 0;
        break;
      }
      case 'shl':
        state.acc = (state.acc << o.bits) >>> 0;
        break;
      case 'shr':
        state.acc = state.acc >>> o.bits;
        break;
      case 'rol':
        state.acc = rol(state.acc, o.bits);
        break;
      case 'ror':
        state.acc = rol(state.acc, (32 - o.bits) % 32);
        break;
      case 'mask':
        state.acc = o.bits === 32 ? state.acc >>> 0 : (state.acc & ((1 << o.bits) - 1)) >>> 0;
        break;
      case 'table':
        state.acc = o.values[state.acc & 0xff] >>> 0;
        break;
      case 'repeat':
        for (let i = 0; i < o.count; i++) run(o.body, state);
        break;
      case 'store':
        state.key = state.acc;
        break;
    }
  }
}

/** Validate `plugin`'s widths and program against `SEED_KEY_LIMITS` and compile it. Throws
 *  `SeedKeyError` with a readable message on any violation — before anything runs. The program is
 *  snapshotted here, so a later change to `plugin` cannot change what the compiled routine does. */
export function compileSeedKey(plugin: SeedKeyPluginV1): CompiledSeedKey {
  const { seedBytes, keyBytes } = plugin;
  if (seedBytes !== 2 && seedBytes !== 4) throw new SeedKeyError('seedBytes must be 2 or 4');
  if (keyBytes !== 2 && keyBytes !== 4) throw new SeedKeyError('keyBytes must be 2 or 4');
  const { steps, stores } = analyse(plugin.program, 'program', 0, { ops: 0 });
  if (!stores) throw new SeedKeyError('The program never stores a key (add a "store" operation).');
  // Snapshot: a later mutation of the caller's object cannot change what runs.
  const program = JSON.parse(JSON.stringify(plugin.program)) as SeedKeyOp[];

  const fn = (seed: number[]): number[] => {
    if (!Array.isArray(seed) || seed.length !== seedBytes) {
      throw new SeedKeyError(
        `The module sent a ${Array.isArray(seed) ? seed.length : 0}-byte seed; this plugin expects ${seedBytes}.`,
      );
    }
    let seedNum = 0;
    for (const b of seed) {
      if (!Number.isInteger(b) || b < 0 || b > 0xff) throw new SeedKeyError('Invalid seed byte.');
      seedNum = ((seedNum << 8) | b) >>> 0;
    }
    const state = { acc: 0, key: null as number | null, seed: seedNum, budget: steps };
    run(program, state);
    if (state.key === null) throw new SeedKeyError('The program finished without a key.');
    const key = state.key;
    const out: number[] = [];
    for (let i = keyBytes - 1; i >= 0; i--) out.push((key >>> (8 * i)) & 0xff);
    return out;
  };
  Object.defineProperty(fn, 'steps', { value: steps, enumerable: true });
  return fn as CompiledSeedKey;
}

/** Ops written in a program (nested ones included) — for the import preview. */
export function countSeedKeyOps(program: SeedKeyOp[]): number {
  let n = 0;
  for (const o of program) {
    n++;
    if (o.op === 'repeat') n += countSeedKeyOps(o.body);
  }
  return n;
}
