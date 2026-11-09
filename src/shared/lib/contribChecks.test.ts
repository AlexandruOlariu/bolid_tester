import * as fs from 'fs';
import * as path from 'path';
import {
  checkCapture,
  checkDtcFileHeader,
  checkDtcTables,
  checkFixtureFile,
  checkLabelPacks,
  checkLicenceHygiene,
  checkVehicleDoc,
  duplicateKeysInSource,
  formatContribReport,
  hasContribErrors,
  leadingComment,
  MAX_FIXTURE_BYTES,
  SAE_DTC_KEY_PATTERN,
  stripComments,
  type ContribProblem,
} from './contribChecks';
import { DTC_CODE_PATTERN } from '../obd-core/obd/dtcDatabase';
import { PROTOCOL_LABELS } from '../obd-core/obd/protocols';
import { LABEL_PACKS } from '../labels/registry';
import { vagEdc17Golf } from '../labels/packs/vagEdc17Golf';
import { vagBcmPq35 } from '../labels/packs/vagBcmPq35';
import { carFixturesFor } from '../vehicles/validatedOn';
import { readFixtureFiles } from '../obd-core/transport/fixtureFiles';

const PROTOCOLS = Object.keys(PROTOCOL_LABELS);
/** The committed replay fixtures, so a real doc's "Validated on the car" table is checked against
 *  its real car fixtures (as the validator and vehicle-docs-sync do). */
const FIXTURES = readFixtureFiles();
const CAN = 'ISO_15765_4_CAN_11_500';
const messages = (ps: ContribProblem[]) => ps.map((p) => p.message);

const vehicleDoc = (fm: Record<string, string>, withTable = true) =>
  [
    '---',
    ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`),
    '---',
    '',
    '# Car',
    '',
    ...(withTable
      ? [
          '## Validated on the car',
          '',
          '| Date                | App build | Adapter | Flow | Result | Fixture |',
          '| ------------------- | --------- | ------- | ---- | ------ | ------- |',
          '| _not yet validated_ |           |         |      |        |         |',
        ]
      : []),
  ].join('\n');

const GOOD_FM = {
  id: 'seat-leon-2010-16tdi',
  name: 'Seat Leon 2010 1.6 TDI',
  expectedProtocol: CAN,
  supportedPidCount: '12',
  extended: 'false',
  validatedOn: '',
  observedProtocol: '',
};

describe('checkVehicleDoc', () => {
  it('passes every real vehicle doc', () => {
    const dir = path.resolve(__dirname, '../../../docs/vehicles');
    const docs = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
    expect(docs.length).toBeGreaterThanOrEqual(3);
    for (const f of docs) {
      const md = fs.readFileSync(path.join(dir, f), 'utf8');
      const id = f.replace(/\.md$/, '');
      expect(
        checkVehicleDoc(`docs/vehicles/${f}`, md, PROTOCOLS, carFixturesFor(id, FIXTURES)),
      ).toEqual([]);
    }
  });

  it('passes the front-matter example in docs/contributing/vehicle-profile.md as written', () => {
    const guide = fs.readFileSync(
      path.resolve(__dirname, '../../../docs/contributing/vehicle-profile.md'),
      'utf8',
    );
    const block = /```yaml\r?\n([\s\S]*?)\r?\n\s*```/.exec(guide)?.[1] ?? '';
    const frontMatter = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .join('\n');
    expect(frontMatter.startsWith('---\nid: ')).toBe(true);
    // The guide's front-matter, then the body of a minimal doc (its "Validated on the car" table).
    const body = vehicleDoc({}).split('\n').slice(2).join('\n');
    const md = `${frontMatter}\n${body}`;
    expect(checkVehicleDoc('docs/vehicles/skoda-octavia-2010-16tdi.md', md, PROTOCOLS, [])).toEqual(
      [],
    );
  });

  it('passes a well-formed new doc', () => {
    expect(
      checkVehicleDoc('docs/vehicles/seat-leon-2010-16tdi.md', vehicleDoc(GOOD_FM), PROTOCOLS, []),
    ).toEqual([]);
  });

  it('flags missing keys, a foreign id, an unknown protocol and bad values', () => {
    const md = vehicleDoc({
      id: 'Seat_Leon',
      expectedProtocol: 'CAN_FAST',
      supportedPidCount: 'twelve',
      extended: 'yes',
    });
    expect(messages(checkVehicleDoc('docs/vehicles/seat-leon.md', md, PROTOCOLS, []))).toEqual([
      'front-matter is missing "name"',
      'id "Seat_Leon" does not match the file name "seat-leon.md"',
      'id "Seat_Leon" is not kebab-case (lower-case letters, digits, "-")',
      expect.stringMatching(/^expectedProtocol "CAN_FAST" is not a known protocol \(one of AUTO/),
      'supportedPidCount "twelve" is not a whole number',
      'extended "yes" must be true or false',
    ]);
  });

  it('flags a doc without front-matter, and applies the validation rules', () => {
    expect(messages(checkVehicleDoc('docs/vehicles/x.md', '# Car', PROTOCOLS, []))).toEqual([
      'has no front-matter (the `---` block at the top of the file)',
    ]);
    const validated = vehicleDoc({ ...GOOD_FM, validatedOn: '2026-12-01' }, false);
    expect(
      messages(checkVehicleDoc('docs/vehicles/seat-leon-2010-16tdi.md', validated, PROTOCOLS, [])),
    ).toEqual([
      'validatedOn and observedProtocol must be set together',
      'no "Validated on the car" section',
    ]);
    // A committed car fixture that the table does not list.
    expect(
      messages(
        checkVehicleDoc('docs/vehicles/seat-leon-2010-16tdi.md', vehicleDoc(GOOD_FM), PROTOCOLS, [
          'connect.json',
        ]),
      ),
    ).toEqual(['car fixture connect.json is not listed in the table']);
  });
});

describe('checkFixtureFile', () => {
  const KNOWN = ['golf-plus-2009-20tdi', 'generic'];
  const fixture = (meta: Record<string, unknown> | undefined, extra: object = {}) =>
    JSON.stringify({ name: 'x', pairs: { ATZ: 'ELM327 v2.2' }, meta, ...extra });
  const GOOD_META = { source: 'car', vehicleId: 'golf-plus-2009-20tdi', flow: 'connect' };
  const check = (rel: string, text: string, size = text.length) =>
    messages(checkFixtureFile(rel, text, size, KNOWN));

  it('passes a well-formed fixture and every committed one', () => {
    expect(check('golf-plus-2009-20tdi/connect.json', fixture(GOOD_META))).toEqual([]);
    const dir = path.resolve(__dirname, '../obd-core/transport/fixtures');
    for (const vehicle of fs.readdirSync(dir)) {
      for (const f of fs.readdirSync(path.join(dir, vehicle))) {
        const text = fs.readFileSync(path.join(dir, vehicle, f), 'utf8');
        const known = [vehicle];
        expect(checkFixtureFile(`${vehicle}/${f}`, text, text.length, known)).toEqual([]);
      }
    }
  });

  it('fails a fixture whose meta.vehicleId has no doc, or sits in another folder', () => {
    const meta = { ...GOOD_META, vehicleId: 'seat-leon-2010-16tdi' };
    expect(check('seat-leon-2010-16tdi/connect.json', fixture(meta))).toEqual([
      'meta.vehicleId "seat-leon-2010-16tdi" has no vehicle doc (docs/vehicles/seat-leon-2010-16tdi.md)',
    ]);
    expect(check('generic/connect.json', fixture(GOOD_META))).toEqual([
      'lives in fixtures/generic/ but meta.vehicleId is "golf-plus-2009-20tdi"',
    ]);
  });

  it('fails missing pairs / meta / flow / source, bad JSON and an oversized file', () => {
    expect(check('generic/a.json', JSON.stringify({ meta: { ...GOOD_META } }))).toContain(
      'has no "pairs" object (command → response)',
    );
    expect(check('generic/a.json', fixture(undefined))).toEqual([
      'has no "meta" object (source, vehicleId, flow)',
    ]);
    expect(
      check(
        'golf-plus-2009-20tdi/a.json',
        fixture({ vehicleId: 'golf-plus-2009-20tdi', flow: ' ' }),
      ),
    ).toEqual(['meta.flow is missing or empty', 'meta.source must be "car" or "simulator"']);
    expect(check('generic/a.json', '{ "pairs": ')[0]).toMatch(/^is not valid JSON/);
    expect(check('golf-plus-2009-20tdi/a.json', fixture(GOOD_META), MAX_FIXTURE_BYTES + 1)).toEqual(
      ['is 201 KB; a fixture may be at most 200 KB (trim it to one flow)'],
    );
    expect(check('golf-plus-2009-20tdi/a.json', fixture(GOOD_META), MAX_FIXTURE_BYTES)).toEqual([]);
  });
});

describe('checkLabelPacks', () => {
  const entry = (pack: unknown, file = 'src/shared/labels/packs/x.ts') => ({ file, pack });
  const passat = {
    id: 'vag-edc15-038906019',
    module: 'EDC15 engine (1.9 TDI PD)',
    partNumberPrefixes: ['038906019'],
    measurements: {
      '0001': { name: 'Engine speed', unit: 'rpm' },
      '0002': { name: 'Injection quantity', unit: 'mg/str' },
    },
  };

  it('passes the bundled packs as registered', () => {
    const entries = LABEL_PACKS.map((p) => entry(p, `packs/${p.id}.ts`));
    expect(
      checkLabelPacks(
        entries,
        LABEL_PACKS.map((p) => p.id),
      ),
    ).toEqual([]);
  });

  it('passes a new pack once it is registered, and fails it while it is not', () => {
    const entries = [entry(vagEdc17Golf), entry(vagBcmPq35), entry(passat, 'packs/passat.ts')];
    const ids = [vagEdc17Golf.id, vagBcmPq35.id];
    expect(checkLabelPacks(entries, [...ids, passat.id])).toEqual([]);
    expect(messages(checkLabelPacks(entries, ids))).toEqual([
      'pack "vag-edc15-038906019" is not registered in LABEL_PACKS (src/shared/labels/registry.ts)',
    ]);
  });

  it('fails an identical prefix in a second pack, and only warns on a nested one', () => {
    const twin = { ...passat, id: 'vag-edc15-twin', partNumberPrefixes: ['038 906 019'] };
    const nested = { ...passat, id: 'vag-edc15-038906019AB', partNumberPrefixes: ['038906019AB'] };
    const ids = [passat.id, twin.id, nested.id];
    const found = checkLabelPacks([entry(passat), entry(twin), entry(nested)], ids);
    expect(found.filter((p) => p.level === 'error').map((p) => p.message)).toEqual([
      'vag-edc15-twin: prefix "038 906 019" contains spaces',
      'prefix "038906019" of "vag-edc15-twin" is identical to a prefix of "vag-edc15-038906019" (src/shared/labels/packs/x.ts) — two packs cannot claim the same part numbers',
    ]);
    expect(found.filter((p) => p.level === 'warning').map((p) => p.message)).toEqual([
      'prefix "038906019AB" (vag-edc15-038906019AB) overlaps "038906019" (vag-edc15-038906019): the longer prefix wins for its part numbers',
      'prefix "038906019AB" (vag-edc15-038906019AB) overlaps "038906019" (vag-edc15-twin): the longer prefix wins for its part numbers',
    ]);
  });

  it('fails a duplicate id, bad DID keys, empty names and malformed groups', () => {
    const bad = {
      id: 'vag-edc15-038906019',
      module: ' ',
      partNumberPrefixes: ['0389', '0389'],
      measurements: { '17a1': { name: 'x' }, '1702': { name: '' } },
      adaptations: { '3001': { name: 'Idle', unit: 5 } },
      codingBits: { F1A0: [{ byte: 0, bit: 9, name: 'x' }] },
      measuringGroups: {
        '0001': { name: 'g', dids: ['1701'] },
        '002': { name: 'g', dids: ['1701', '1701', '1702', '1703', '1704'] },
      },
    };
    expect(messages(checkLabelPacks([entry(passat), entry(bad)], [passat.id]))).toEqual([
      'vag-edc15-038906019: module (display name) is empty',
      'vag-edc15-038906019: prefix "0389" is listed twice',
      // '1702' is an integer-like key, so JavaScript enumerates it first.
      'vag-edc15-038906019.measurements.1702 has no name',
      'vag-edc15-038906019.measurements: DID key "17a1" is not four upper-case hex digits',
      'vag-edc15-038906019.adaptations.3001.unit must be a string',
      'vag-edc15-038906019.codingBits.F1A0: every entry needs a byte ≥ 0, a bit 0–7 and a name',
      'vag-edc15-038906019.measuringGroups.0001: group number must be one to three digits',
      'vag-edc15-038906019.measuringGroups.002 has more than four DIDs',
      'vag-edc15-038906019.measuringGroups.002: DID 1701 is listed twice',
      'pack id "vag-edc15-038906019" is also used in src/shared/labels/packs/x.ts',
    ]);
  });

  it('fails a pack without an id or prefixes', () => {
    expect(messages(checkLabelPacks([entry({ module: 'm', partNumberPrefixes: [] })], []))).toEqual(
      ['pack has no id', '(no id): partNumberPrefixes must list at least one part-number prefix'],
    );
  });
});

describe('checkDtcTables', () => {
  const table = (file: string, exportName: string, t: Record<string, unknown>) => ({
    file,
    exportName,
    table: t,
  });

  it('uses the DTC database key pattern', () => {
    expect(SAE_DTC_KEY_PATTERN.source).toBe(DTC_CODE_PATTERN.source);
  });

  it('passes distinct tables in both number spaces', () => {
    expect(
      checkDtcTables([
        table('p0.ts', 'P0', { P0101: 'Mass Air Flow Circuit Range/Performance' }),
        table('vag.ts', 'VAG_P1', { P1555: 'Charge Pressure Control Positive Deviation' }),
        table('vag.ts', 'VAG_DTC_TEXTS', { '00532': 'Supply voltage B+' }),
        table('fiat.ts', 'FIAT_P1', {}),
      ]),
    ).toEqual([]);
  });

  it('fails a code defined in two files, a bad key and an empty description', () => {
    expect(
      messages(
        checkDtcTables([
          table('generic/p0-part1.ts', 'P0_PART1', { P0101: 'MAF', p0102: 'MAF low' }),
          table('manufacturer/vag-p1.ts', 'VAG_P1', { P0101: 'again', P1000: ' ' }),
          table('manufacturer/vag.ts', 'VAG_DTC_TEXTS', { '532': 'Supply voltage' }),
        ]),
      ),
    ).toEqual([
      'P0_PART1: key "p0102" is not an upper-case SAE code like P0101',
      'P0101 is defined in both generic/p0-part1.ts (P0_PART1) and manufacturer/vag-p1.ts (VAG_P1)',
      'VAG_P1.P1000 has an empty description',
      'VAG_DTC_TEXTS: key "532" is not a 5-digit VAG fault number',
    ]);
  });

  it('finds keys listed twice in one source file (comments ignored)', () => {
    const src = [
      '/** P0101: in a comment does not count */',
      'export const P0 = {',
      "  P0101: 'MAF',",
      "  P0102: 'MAF low',",
      "  'P0101': 'MAF again',",
      "  '00532': 'a',",
      "  '00532': 'b',",
      '};',
    ].join('\n');
    expect(duplicateKeysInSource(src)).toEqual(['P0101', '00532']);
  });

  it('requires a License: line in the header', () => {
    const withLicence = '/**\n * Codes.\n *\n * License: MIT\n */\nexport const X = {};';
    expect(checkDtcFileHeader('a.ts', withLicence)).toEqual([]);
    expect(messages(checkDtcFileHeader('a.ts', '/** Codes. */\n// License: MIT\n'))).toEqual([
      'file header has no "License:" line (e.g. "License: MIT — authored for bolid-tester")',
    ]);
  });

  it('every committed DTC data file carries a License: line', () => {
    const root = path.resolve(__dirname, '../obd-core/obd/dtcDatabase');
    for (const family of ['generic', 'manufacturer']) {
      for (const f of fs.readdirSync(path.join(root, family))) {
        const src = fs.readFileSync(path.join(root, family, f), 'utf8');
        expect(checkDtcFileHeader(`${family}/${f}`, src)).toEqual([]);
      }
    }
  });
});

describe('checkCapture', () => {
  const KNOWN = ['golf-plus-2009-20tdi'];
  const csv = (...header: string[]) =>
    [...header, 't_ms,id,dlc,bytes', '0,7E0,8,02 01 00'].join('\n');

  it('passes the sniffer header and the committed captures', () => {
    expect(
      checkCapture(
        'a.csv',
        csv('# bolid-tester bus capture (csv)', '# vehicle: golf-plus-2009-20tdi'),
        KNOWN,
      ),
    ).toEqual([]);
    const text = fs.readFileSync(
      path.resolve(__dirname, '../../../docs/captures/synthetic-golf.csv'),
      'utf8',
    );
    expect(checkCapture('docs/captures/synthetic-golf.csv', text, KNOWN)).toEqual([]);
  });

  it('fails a CSV without a header, without a vehicle line, or with an unknown vehicle', () => {
    expect(messages(checkCapture('a.csv', csv(), KNOWN))).toEqual([
      'has no "#" header block — share the CSV from the Bus sniffer',
    ]);
    expect(messages(checkCapture('a.csv', csv('# protocol: CAN'), KNOWN))).toEqual([
      'header has no "# vehicle: <id>" line',
    ]);
    expect(messages(checkCapture('a.csv', csv('# vehicle: unknown'), KNOWN))).toEqual([
      '"# vehicle: unknown" is not a registry vehicle id',
    ]);
  });
});

describe('checkLicenceHygiene', () => {
  it('allows a warning about GPL sources in prose comments', () => {
    const src = [
      '/**',
      ' * Authored for this project. Nothing is copied from GPL sources (python-OBD `codes.py`).',
      ' * License: MIT',
      ' */',
      "export const X = { P0101: 'MAF' };",
    ].join('\n');
    expect(checkLicenceHygiene('a.ts', src)).toEqual([]);
  });

  it('fails GPL / python-OBD / pyOBD in the data, or as the Source / License', () => {
    expect(
      messages(checkLicenceHygiene('a.ts', "export const X = { P0101: 'from pyOBD' };")),
    ).toEqual([
      'mentions "pyOBD" in its data — GPL-licensed code lists (python-OBD, pyOBD) are off-limits',
    ]);
    expect(
      messages(
        checkLicenceHygiene(
          'a.ts',
          '/**\n * Source: python-OBD codes.py\n * License: GPL-2.0\n */',
        ),
      ),
    ).toEqual([
      'its Source line names "python-OBD" — contributed data must not come from GPL sources',
      'its License line names "GPL" — contributed data must not come from GPL sources',
    ]);
    expect(messages(checkLicenceHygiene('a.ts', '// License: LGPL-3.0'))).toEqual([
      'its License line names "LGPL" — contributed data must not come from GPL sources',
    ]);
  });

  it('passes every committed profile, pack and DTC file', () => {
    const dirs = [
      path.resolve(__dirname, '../vehicles'),
      path.resolve(__dirname, '../labels/packs'),
      path.resolve(__dirname, '../obd-core/obd/dtcDatabase/generic'),
      path.resolve(__dirname, '../obd-core/obd/dtcDatabase/manufacturer'),
    ];
    for (const dir of dirs) {
      for (const f of fs
        .readdirSync(dir)
        .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
        expect(checkLicenceHygiene(f, fs.readFileSync(path.join(dir, f), 'utf8'))).toEqual([]);
      }
    }
  });
});

describe('source helpers', () => {
  it('strips comments but keeps strings, including ones that contain //', () => {
    const src = 'const a = \'http://x\'; // GPL\n/* GPL\n block */ const b = "/* no */";';
    expect(stripComments(src)).toBe('const a = \'http://x\'; \n\n const b = "/* no */";');
    expect(stripComments('const t = `a // b`; // c')).toBe('const t = `a // b`; ');
    expect(stripComments("const e = 'it\\'s'; // x")).toBe("const e = 'it\\'s'; ");
  });

  it('returns the leading block or line comment', () => {
    expect(leadingComment('\n/** a\n * b */\nconst x = 1; /* not */')).toBe('/** a\n * b */');
    expect(leadingComment('// a\n// b\nconst x = 1;')).toBe('// a\n// b');
    expect(leadingComment('const x = 1; // late')).toBe('');
  });
});

describe('formatContribReport', () => {
  const err: ContribProblem = {
    area: 'dtc-database',
    level: 'error',
    file: 'b.ts',
    message: 'dup',
  };
  const warn: ContribProblem = {
    area: 'label-packs',
    level: 'warning',
    file: 'a.ts',
    message: 'overlap',
  };

  it('groups by area in a fixed order, errors first, with a summary line', () => {
    expect(hasContribErrors([warn])).toBe(false);
    expect(hasContribErrors([warn, err])).toBe(true);
    expect(formatContribReport([err, warn], 7)).toBe(
      [
        'Contribution checks FAILED: 1 error(s), 1 warning(s) in 7 file(s).',
        '',
        'Label packs (src/shared/labels/packs)',
        '  warning a.ts: overlap',
        '',
        'DTC database (src/shared/obd-core/obd/dtcDatabase)',
        '  error   b.ts: dup',
        '',
      ].join('\n'),
    );
    expect(formatContribReport([], 3)).toBe(
      'Contribution checks passed: 3 file(s), 0 warning(s).\n',
    );
  });
});
