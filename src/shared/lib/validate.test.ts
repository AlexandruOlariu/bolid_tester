import { v, validate, MAX_ERRORS } from './validate';

const errorsOf = (r: ReturnType<typeof validate>) => (r.ok ? [] : r.errors);

describe('validate combinators', () => {
  it('str: type, length and pattern', () => {
    const s = v.str({ min: 1, max: 5, pattern: /^[a-z]+$/, desc: 'lowercase letters' });
    expect(validate(s, 'abc')).toEqual({ ok: true, value: 'abc' });
    expect(errorsOf(validate(s, 3))).toEqual(['/: expected a string, got number']);
    expect(errorsOf(validate(s, ''))).toEqual(['/: must not be empty']);
    expect(errorsOf(validate(s, 'abcdef'))).toEqual(['/: must be at most 5 characters']);
    expect(errorsOf(validate(s, 'AB'))).toEqual(['/: expected lowercase letters, got "AB"']);
  });

  it('num: finite, integer, bounds', () => {
    const n = v.num({ int: true, min: 0, max: 10 });
    expect(validate(n, 7)).toEqual({ ok: true, value: 7 });
    expect(validate(n, 7.5).ok).toBe(false);
    expect(validate(n, -1).ok).toBe(false);
    expect(validate(n, 11).ok).toBe(false);
    expect(validate(n, '7').ok).toBe(false);
    expect(validate(v.num(), Number.NaN).ok).toBe(false);
    expect(validate(v.num(), Infinity).ok).toBe(false);
  });

  it('bool and lit', () => {
    expect(validate(v.bool(), false)).toEqual({ ok: true, value: false });
    expect(validate(v.bool(), 'true').ok).toBe(false);
    const fuel = v.lit('diesel', 'petrol');
    expect(validate(fuel, 'petrol')).toEqual({ ok: true, value: 'petrol' });
    expect(errorsOf(validate(fuel, 'coal'))).toEqual([
      '/: expected one of diesel|petrol, got "coal"',
    ]);
  });

  it('opt and nullable', () => {
    expect(validate(v.opt(v.num()), undefined)).toEqual({ ok: true, value: undefined });
    expect(validate(v.opt(v.num()), null).ok).toBe(false);
    expect(validate(v.nullable(v.num()), null)).toEqual({ ok: true, value: null });
    expect(validate(v.nullable(v.num()), undefined).ok).toBe(false);
  });

  it('arr: items, caps and item paths', () => {
    const a = v.arr(v.num(), { min: 1, max: 3 });
    expect(validate(a, [1, 2])).toEqual({ ok: true, value: [1, 2] });
    expect(errorsOf(validate(a, []))).toEqual(['/: must not be empty']);
    expect(errorsOf(validate(a, [1, 2, 3, 4]))).toEqual(['/: at most 3 items allowed, got 4']);
    expect(errorsOf(validate(a, [1, 'x']))).toEqual(['/1: expected a number, got "x"']);
    expect(errorsOf(validate(a, { 0: 1 }))).toEqual(['/: expected a list, got object']);
  });

  it('rec: key pattern, reserved keys and caps', () => {
    const r = v.rec(v.num(), /^[0-9A-F]{4}$/, { max: 2, keyDesc: 'a DID' });
    expect(validate(r, { '1701': 1 })).toEqual({ ok: true, value: { '1701': 1 } });
    expect(errorsOf(validate(r, { '17G1': 1 }))).toEqual(['/: key "17G1" is not a DID']);
    expect(errorsOf(validate(r, { A: 1, B: 2, C: 3 }))).toEqual([
      '/: at most 2 entries allowed, got 3',
    ]);
    // JSON.parse creates an own "__proto__" key; it must never reach the output.
    const polluted = JSON.parse('{"__proto__": {"x": 1}, "constructor": 2}') as unknown;
    const res = validate(v.rec(v.num()), polluted);
    expect(errorsOf(res)).toEqual([
      '/: key "__proto__" is not allowed',
      '/: key "constructor" is not allowed',
    ]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('obj: nested error paths, required keys, optional keys stay absent', () => {
    const car = v.obj<{ name: string; year?: number; fuel: 'diesel' | 'petrol' }>({
      name: v.str({ min: 1 }),
      year: v.opt(v.num({ int: true })),
      fuel: v.lit('diesel', 'petrol'),
    });
    const file = v.obj<{
      payload: { vehicle: { name: string; year?: number; fuel: 'diesel' | 'petrol' } };
    }>({
      payload: v.obj({ vehicle: car }),
    });
    const good = validate(file, { payload: { vehicle: { name: 'Golf', fuel: 'diesel' } } });
    expect(good).toEqual({
      ok: true,
      value: { payload: { vehicle: { name: 'Golf', fuel: 'diesel' } } },
    });
    expect(good.ok && 'year' in good.value.payload.vehicle).toBe(false);
    expect(
      errorsOf(validate(file, { payload: { vehicle: { name: 'Golf', fuel: 'coal' } } })),
    ).toEqual(['/payload/vehicle/fuel: expected one of diesel|petrol, got "coal"']);
    expect(errorsOf(validate(file, { payload: { vehicle: { fuel: 'diesel' } } }))).toEqual([
      '/payload/vehicle/name: is required',
    ]);
    expect(errorsOf(validate(file, { payload: [] }))).toEqual([
      '/payload: expected an object, got array',
    ]);
  });

  it("obj: extra 'strip' (default) drops unknown keys, 'reject' reports them", () => {
    const shape = { a: v.num() };
    expect(validate(v.obj<{ a: number }>(shape), { a: 1, future: 'x' })).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(
      errorsOf(validate(v.obj<{ a: number }>(shape, { extra: 'reject' }), { a: 1, b: 2 })),
    ).toEqual(['/b: unknown field']);
  });

  it('obj: reads own properties only and rejects class instances', () => {
    const proto = { a: 1 };
    const child = Object.create(proto) as { a?: number };
    expect(validate(v.obj<{ a: number }>({ a: v.num() }), child).ok).toBe(false);
    expect(validate(v.obj<{ a: number }>({ a: v.num() }), new Date()).ok).toBe(false);
  });

  it('hex(4): uppercase hex of exact length', () => {
    expect(validate(v.hex(4), '17A1')).toEqual({ ok: true, value: '17A1' });
    expect(validate(v.hex(4), '17a1').ok).toBe(false);
    expect(validate(v.hex(4), '171').ok).toBe(false);
    expect(validate(v.hex(4), '17011').ok).toBe(false);
    expect(validate(v.hex(4), '17G1').ok).toBe(false);
    expect(validate(v.hex(2), 1).ok).toBe(false);
  });

  it('escapes JSON-pointer segments and caps the error count', () => {
    const r = v.obj<{ 'a/b~c': number }>({ 'a/b~c': v.num() });
    expect(errorsOf(validate(r, { 'a/b~c': 'x' }))).toEqual([
      '/a~1b~0c: expected a number, got "x"',
    ]);
    const many = validate(
      v.arr(v.num()),
      Array.from({ length: 200 }, () => 'x'),
    );
    expect(errorsOf(many)).toHaveLength(MAX_ERRORS);
  });
});
