/** The seed→key DSL (plan 23): every op against hand-computed vectors, the limits, widths and
 *  determinism. The programs here are arithmetic test vectors, not real routines. */
import {
  compileSeedKey,
  countSeedKeyOps,
  SEED_KEY_LIMITS,
  SeedKeyError,
  type SeedKeyOp,
  type SeedKeyPluginV1,
} from './seedKeyDsl';

function plugin(program: SeedKeyOp[], widths: Partial<SeedKeyPluginV1> = {}): SeedKeyPluginV1 {
  return {
    schema: 'bolid.seedkey.v1',
    name: 'test vector',
    applies: { reqHeader: '70E', level: 3 },
    seedBytes: 4,
    keyBytes: 4,
    program,
    ...widths,
  };
}

/** Run `program` from a constant and return the 32-bit result as a number. */
function acc(start: number, ops: SeedKeyOp[]): number {
  const key = compileSeedKey(plugin([{ op: 'const', value: start }, ...ops, { op: 'store' }]))([
    0, 0, 0, 0,
  ]);
  return ((key[0] << 24) | (key[1] << 16) | (key[2] << 8) | key[3]) >>> 0;
}

describe('seedKeyDsl ops', () => {
  it('load reads the seed big-endian (2 and 4 bytes) and store truncates to keyBytes', () => {
    const two = plugin([{ op: 'load', from: 'seed' }, { op: 'store' }], {
      seedBytes: 2,
      keyBytes: 2,
    });
    expect(compileSeedKey(two)([0x12, 0x34])).toEqual([0x12, 0x34]);
    const four = plugin([{ op: 'load', from: 'seed' }, { op: 'store' }]);
    expect(compileSeedKey(four)([0xde, 0xad, 0xbe, 0xef])).toEqual([0xde, 0xad, 0xbe, 0xef]);
    const narrow = plugin([{ op: 'load', from: 'seed' }, { op: 'store' }], { keyBytes: 2 });
    expect(compileSeedKey(narrow)([0xde, 0xad, 0xbe, 0xef])).toEqual([0xbe, 0xef]);
    const wide = plugin([{ op: 'load', from: 'seed' }, { op: 'store' }], { seedBytes: 2 });
    expect(compileSeedKey(wide)([0x12, 0x34])).toEqual([0x00, 0x00, 0x12, 0x34]);
  });

  it('the fixture vector: load → xor 0xFFFF → store turns 12 34 into ED CB', () => {
    const p = plugin(
      [{ op: 'load', from: 'seed' }, { op: 'xor', value: 0xffff }, { op: 'store' }],
      { seedBytes: 2, keyBytes: 2 },
    );
    expect(compileSeedKey(p)([0x12, 0x34])).toEqual([0xed, 0xcb]);
  });

  it('add / sub / mul wrap modulo 2^32', () => {
    expect(acc(0xffffffff, [{ op: 'add', value: 2 }])).toBe(1);
    expect(acc(0, [{ op: 'sub', value: 1 }])).toBe(0xffffffff);
    expect(acc(0x10000, [{ op: 'mul', value: 0x10000 }])).toBe(0);
    expect(acc(0x12345678, [{ op: 'mul', value: 2 }])).toBe(0x2468acf0);
    expect(acc(0xffffffff, [{ op: 'mul', value: 0xffffffff }])).toBe(1);
  });

  it('xor / and / or / not', () => {
    expect(acc(0xf0f0, [{ op: 'xor', value: 0xffff }])).toBe(0x0f0f);
    expect(acc(0xf0f0, [{ op: 'and', value: 0xff00 }])).toBe(0xf000);
    expect(acc(0xf000, [{ op: 'or', value: 0x000f }])).toBe(0xf00f);
    expect(acc(0, [{ op: 'not' }])).toBe(0xffffffff);
    expect(acc(0x80000000, [{ op: 'xor', value: 0x80000000 }])).toBe(0);
  });

  it('swap16 exchanges the halves, bswap reverses the bytes', () => {
    expect(acc(0xaabbccdd, [{ op: 'swap16' }])).toBe(0xccddaabb);
    expect(acc(0xaabbccdd, [{ op: 'bswap' }])).toBe(0xddccbbaa);
  });

  it('shl / shr / rol / ror, including 0 and 31 bits', () => {
    expect(acc(0x12345678, [{ op: 'shl', bits: 4 }])).toBe(0x23456780);
    expect(acc(0x12345678, [{ op: 'shr', bits: 4 }])).toBe(0x01234567);
    expect(acc(0x12345678, [{ op: 'rol', bits: 8 }])).toBe(0x34567812);
    expect(acc(0x12345678, [{ op: 'ror', bits: 8 }])).toBe(0x78123456);
    expect(acc(0x12345678, [{ op: 'rol', bits: 0 }])).toBe(0x12345678);
    expect(acc(0x12345678, [{ op: 'ror', bits: 0 }])).toBe(0x12345678);
    expect(acc(1, [{ op: 'shl', bits: 31 }])).toBe(0x80000000);
    expect(acc(0x80000000, [{ op: 'shr', bits: 31 }])).toBe(1);
    expect(acc(0x80000001, [{ op: 'rol', bits: 1 }])).toBe(0x00000003);
  });

  it('mask keeps 8, 16 or 32 bits', () => {
    expect(acc(0x12345678, [{ op: 'mask', bits: 8 }])).toBe(0x78);
    expect(acc(0x12345678, [{ op: 'mask', bits: 16 }])).toBe(0x5678);
    expect(acc(0x12345678, [{ op: 'mask', bits: 32 }])).toBe(0x12345678);
  });

  it('table looks up the low byte of the accumulator', () => {
    const values = Array.from({ length: 256 }, (_, i) => (255 - i) * 0x01010101);
    expect(acc(0x1205, [{ op: 'table', values, index: 'low8' }])).toBe(250 * 0x01010101);
  });

  it('repeat runs its body count times, nesting two deep', () => {
    expect(acc(1, [{ op: 'repeat', count: 5, body: [{ op: 'shl', bits: 1 }] }])).toBe(32);
    expect(
      acc(0, [
        {
          op: 'repeat',
          count: 3,
          body: [{ op: 'repeat', count: 4, body: [{ op: 'add', value: 1 }] }],
        },
      ]),
    ).toBe(12);
    expect(acc(7, [{ op: 'repeat', count: 0, body: [{ op: 'const', value: 0 }] }])).toBe(7);
  });

  it('the last store wins', () => {
    const p = plugin([
      { op: 'const', value: 1 },
      { op: 'store' },
      { op: 'const', value: 2 },
      { op: 'store' },
    ]);
    expect(compileSeedKey(p)([0, 0, 0, 0])).toEqual([0, 0, 0, 2]);
  });
});

describe('seedKeyDsl compile', () => {
  it('counts executed steps exactly', () => {
    const p = plugin([
      { op: 'const', value: 0 },
      {
        op: 'repeat',
        count: 3,
        body: [{ op: 'repeat', count: 4, body: [{ op: 'add', value: 1 }] }],
      },
      { op: 'store' },
    ]);
    // const + repeat + 3 × (repeat + 4 × add) + store
    expect(compileSeedKey(p).steps).toBe(1 + 1 + 3 * (1 + 4) + 1);
    expect(countSeedKeyOps(p.program)).toBe(5);
  });

  it('rejects repeats nested more than two deep', () => {
    const deep = plugin([
      {
        op: 'repeat',
        count: 1,
        body: [
          { op: 'repeat', count: 1, body: [{ op: 'repeat', count: 1, body: [{ op: 'not' }] }] },
        ],
      },
      { op: 'store' },
    ]);
    expect(() => compileSeedKey(deep)).toThrow(/nest at most 2/);
  });

  it('rejects a program over maxSteps before it runs', () => {
    const big = plugin([
      {
        op: 'repeat',
        count: 64,
        body: [{ op: 'repeat', count: 64, body: [{ op: 'add', value: 1 }] }],
      },
      { op: 'store' },
    ]);
    expect(() => compileSeedKey(big)).toThrow(SeedKeyError);
    expect(() => compileSeedKey(big)).toThrow(/more than 4096 steps/);
  });

  it('rejects more than maxOps operations', () => {
    const ops: SeedKeyOp[] = Array.from({ length: SEED_KEY_LIMITS.maxOps }, () => ({
      op: 'not' as const,
    }));
    expect(() => compileSeedKey(plugin([...ops, { op: 'store' }]))).toThrow(/more than 256/);
    expect(() => compileSeedKey(plugin([...ops.slice(1), { op: 'store' }]))).not.toThrow();
  });

  it('rejects bad operands', () => {
    const bad = (op: unknown) => () => compileSeedKey(plugin([op as SeedKeyOp, { op: 'store' }]));
    expect(bad({ op: 'table', values: new Array(255).fill(0), index: 'low8' })).toThrow(
      /exactly 256/,
    );
    expect(bad({ op: 'table', values: new Array(256).fill(-1), index: 'low8' })).toThrow(
      /table value/,
    );
    expect(bad({ op: 'shl', bits: 32 })).toThrow(/0 to 31/);
    expect(bad({ op: 'rol', bits: 1.5 })).toThrow(/0 to 31/);
    expect(bad({ op: 'mask', bits: 12 })).toThrow(/8, 16 or 32/);
    expect(bad({ op: 'add', value: -1 })).toThrow(/0 to 4294967295/);
    expect(bad({ op: 'xor', value: 0x100000000 })).toThrow(/0 to 4294967295/);
    expect(bad({ op: 'const', value: 1.5 })).toThrow(/0 to 4294967295/);
    expect(bad({ op: 'load', from: 'key' })).toThrow(/from: "seed"/);
    expect(bad({ op: 'repeat', count: 65, body: [] })).toThrow(/0–64/);
    expect(
      bad({ op: 'repeat', count: 1, body: Array.from({ length: 33 }, () => ({ op: 'not' })) }),
    ).toThrow(/at most 32/);
    expect(bad({ op: 'eval', code: '1' })).toThrow(/unknown operation/);
    expect(bad(null)).toThrow(/operation object/);
  });

  it('rejects a program that never stores, and bad widths', () => {
    expect(() => compileSeedKey(plugin([{ op: 'load', from: 'seed' }]))).toThrow(/never stores/);
    expect(() =>
      compileSeedKey(plugin([{ op: 'repeat', count: 0, body: [{ op: 'store' }] }])),
    ).toThrow(/never stores/);
    expect(() => compileSeedKey(plugin([{ op: 'store' }], { seedBytes: 3 as 2 }))).toThrow(
      /seedBytes/,
    );
    expect(() => compileSeedKey(plugin([{ op: 'store' }], { keyBytes: 8 as 4 }))).toThrow(
      /keyBytes/,
    );
  });

  it('refuses a seed of the wrong width', () => {
    const k = compileSeedKey(plugin([{ op: 'load', from: 'seed' }, { op: 'store' }]));
    expect(() => k([1, 2])).toThrow(/2-byte seed; this plugin expects 4/);
    expect(() => k([1, 2, 3, 256])).toThrow(/seed byte/);
  });

  it('is deterministic and unaffected by later changes to the plugin object', () => {
    const p = plugin([
      { op: 'load', from: 'seed' },
      { op: 'mul', value: 0x9e3779b1 },
      { op: 'rol', bits: 13 },
      { op: 'store' },
    ]);
    const k = compileSeedKey(p);
    const first = k([1, 2, 3, 4]);
    (p.program[1] as { value: number }).value = 1;
    expect(k([1, 2, 3, 4])).toEqual(first);
    expect(compileSeedKey(plugin(JSON.parse(JSON.stringify(p.program))))([1, 2, 3, 4])).not.toEqual(
      first,
    );
  });
});
