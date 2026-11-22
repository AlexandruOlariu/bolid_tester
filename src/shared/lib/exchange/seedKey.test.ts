/** `bolid.seedkey.v1` validation (plan 23): a valid file, limits refused at import with a clear
 *  message, scope rules, stripping, wrong / newer formats. The programs are test vectors, not real
 *  routines. */
import { parseSeedKeyFile, seedKeyPluginV1 } from './seedKey';
import { parseExchangeFile } from './import';
import { validate } from '../validate';

const TOY = {
  schema: 'bolid.seedkey.v1',
  name: 'Test vector — not a real routine',
  applies: { reqHeader: '70E', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  program: [{ op: 'load', from: 'seed' }, { op: 'xor', value: 0xffff }, { op: 'store' }],
};

const text = (x: unknown) => JSON.stringify(x);

describe('parseSeedKeyFile', () => {
  it('accepts a valid file and reports its size', () => {
    const r = parseSeedKeyFile(text(TOY));
    expect(r).toMatchObject({ ok: true, opCount: 3, steps: 3 });
    if (r.ok) expect(r.plugin).toEqual(TOY);
  });

  it('strips unknown fields everywhere, also inside ops', () => {
    const r = parseSeedKeyFile(
      text({
        ...TOY,
        extra: 1,
        applies: { ...TOY.applies, nope: true },
        program: [{ op: 'load', from: 'seed', js: 'alert(1)' }, { op: 'store' }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugin).not.toHaveProperty('extra');
    expect(r.plugin.applies).toEqual({ reqHeader: '70E', level: 3 });
    expect(r.plugin.program[0]).toEqual({ op: 'load', from: 'seed' });
  });

  it('refuses a program over the step limit with a clear message', () => {
    const r = parseSeedKeyFile(
      text({
        ...TOY,
        program: [
          {
            op: 'repeat',
            count: 64,
            body: [{ op: 'repeat', count: 64, body: [{ op: 'add', value: 1 }] }],
          },
          { op: 'store' },
        ],
      }),
    );
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/safety limits/) });
    if (!r.ok) expect(r.details[0]).toMatch(/more than 4096 steps/);
  });

  it('refuses nesting deeper than two and too many ops', () => {
    const deep = parseSeedKeyFile(
      text({
        ...TOY,
        program: [
          {
            op: 'repeat',
            count: 1,
            body: [
              { op: 'repeat', count: 1, body: [{ op: 'repeat', count: 1, body: [{ op: 'not' }] }] },
            ],
          },
          { op: 'store' },
        ],
      }),
    );
    expect(deep).toMatchObject({ ok: false, error: expect.stringMatching(/safety limits/) });
    if (!deep.ok) expect(deep.details[0]).toMatch(/nest at most 2 deep/);
    const many = parseSeedKeyFile(
      text({
        ...TOY,
        program: [...Array.from({ length: 256 }, () => ({ op: 'not' })), { op: 'store' }],
      }),
    );
    expect(many).toMatchObject({ ok: false, error: expect.stringMatching(/safety limits/) });
  });

  it('names bad ops, scopes and widths', () => {
    const errorsOf = (x: unknown) => {
      const r = validate(seedKeyPluginV1, x);
      return r.ok ? [] : r.errors;
    };
    expect(errorsOf({ ...TOY, program: [{ op: 'eval', code: 'x' }] })).toEqual([
      '/program/0/op: unknown operation "eval"',
    ]);
    expect(errorsOf({ ...TOY, applies: { level: 3 } })[0]).toMatch(/name the module/);
    expect(errorsOf({ ...TOY, applies: { reqHeader: '70E', level: 2 } })[0]).toMatch(/odd/);
    expect(errorsOf({ ...TOY, applies: { reqHeader: '70e', level: 3 } })[0]).toMatch(/uppercase/);
    expect(errorsOf({ ...TOY, seedBytes: 3 })).toEqual(['/seedBytes: must be 2 or 4']);
    expect(
      errorsOf({
        ...TOY,
        program: [{ op: 'table', values: [1, 2], index: 'low8' }, { op: 'store' }],
      })[0],
    ).toMatch(/exactly 256 values/);
    expect(errorsOf({ ...TOY, program: [{ op: 'load', from: 'seed' }] })[0]).toMatch(
      /never stores/,
    );
  });

  it('refuses non-JSON, other files and newer formats readably', () => {
    expect(parseSeedKeyFile('{')).toMatchObject({
      ok: false,
      error: 'This file is not valid JSON.',
    });
    expect(parseSeedKeyFile(text({ schema: 'bolid.labelpack.v1' }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not a security-access plugin/),
    });
    expect(parseSeedKeyFile(text({ ...TOY, schema: 'bolid.seedkey.v2' }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/newer version of the app/),
    });
    expect(parseSeedKeyFile('x'.repeat(200_001))).toMatchObject({ ok: false });
  });

  it('the profile / label-pack importer points a plugin file to its own import', () => {
    expect(parseExchangeFile(text(TOY))).toMatchObject({
      error: expect.stringMatching(/Security access plugins/),
    });
  });
});
