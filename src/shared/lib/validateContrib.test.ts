/** `scripts/validate-contrib.mjs` end to end (plan 33): run on the repository (must pass, as in CI
 *  `verify`) and on a temp copy of the contributable data (`--root`) with one defect at a time, so
 *  each check is proved to fail with a readable message. Also the dry-run contribution from
 *  docs/contributing/label-pack.md: a Passat EDC15 pack, badged illustrative, passes. */
import { spawnSync } from 'child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { findLabelPackIn, LABEL_PACKS } from '../labels/registry';
import type { LabelPack } from '../labels/types';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'validate-contrib.mjs');

function run(root?: string) {
  const args = root ? [SCRIPT, '--root', root] : [SCRIPT];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: REPO_ROOT });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** The parts of the repository the validator reads. */
const COPIED = [
  'docs/vehicles',
  'docs/captures',
  'src/shared/vehicles',
  'src/shared/labels',
  'src/shared/obd-core/obd/protocols.ts',
  'src/shared/obd-core/obd/dtcDatabase',
  'src/shared/obd-core/transport/fixtures',
];

/** The dry-run pack from docs/contributing/label-pack.md, as data (for the registry lookup) and as
 *  the source file a contributor would add (for the validator run on the temp copy). */
const PASSAT: LabelPack = {
  id: 'vag-edc15-038906019',
  module: 'EDC15 engine (1.9 TDI PD)',
  partNumberPrefixes: ['038906019'],
  measurements: {
    '0001': { name: 'Engine speed', unit: 'rpm' },
    '0002': { name: 'Injection quantity', unit: 'mg/str' },
  },
};

const PASSAT_PACK = `import { LabelPack } from '../types';

/** EDC15 engine labels for the 038906019* part numbers (1.9 TDI PD, e.g. the Passat B5.5 example
 *  car). ILLUSTRATIVE — not yet confirmed on a car; written from scratch for this project. */
export const vagEdc15Passat: LabelPack = ${JSON.stringify(PASSAT, null, 2)};
`;

describe('validate-contrib script', () => {
  let tmp: string;
  const file = (rel: string) => join(tmp, ...rel.split('/'));
  const edit = (rel: string, change: (text: string) => string) =>
    writeFileSync(file(rel), change(readFileSync(file(rel), 'utf8')));
  const registerPack = (exportName: string, moduleFile: string) =>
    edit('src/shared/labels/registry.ts', (s) =>
      s
        .replace(
          "import { vagBcmPq35 } from './packs/vagBcmPq35';",
          `import { vagBcmPq35 } from './packs/vagBcmPq35';\nimport { ${exportName} } from './packs/${moduleFile}';`,
        )
        .replace('[vagEdc17Golf, vagBcmPq35]', `[vagEdc17Golf, vagBcmPq35, ${exportName}]`),
    );

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'validate-contrib-'));
  });
  beforeEach(() => {
    rmSync(join(tmp, 'docs'), { recursive: true, force: true });
    rmSync(join(tmp, 'src'), { recursive: true, force: true });
    for (const rel of COPIED) cpSync(join(REPO_ROOT, rel), file(rel), { recursive: true });
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('passes on the repository', () => {
    const r = run();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Contribution checks passed: \d+ file\(s\), 0 warning\(s\)\./);
  });

  it('passes on an unchanged copy', () => {
    expect(run(tmp).code).toBe(0);
  });

  it('fails a DTC code that is defined in a second file', () => {
    edit('src/shared/obd-core/obd/dtcDatabase/manufacturer/vag-p1.ts', (s) =>
      s.replace(
        'export const VAG_P1: Record<string, string> = {',
        "export const VAG_P1: Record<string, string> = {\n  P0101: 'Mass air flow, again',",
      ),
    );
    const r = run(tmp);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Contribution checks FAILED');
    expect(r.err).toMatch(
      /P0101 is defined in both src\/shared\/obd-core\/obd\/dtcDatabase\/generic\/p0-part1\.ts \(P0_PART1\) and src\/shared\/obd-core\/obd\/dtcDatabase\/manufacturer\/vag-p1\.ts \(VAG_P1\)/,
    );
  });

  it('fails a DTC data file without a License line', () => {
    edit('src/shared/obd-core/obd/dtcDatabase/generic/u0.ts', (s) =>
      s.replace(/^ \* License:.*$/m, ' *'),
    );
    const r = run(tmp);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/generic\/u0\.ts: file header has no "License:" line/);
  });

  it('accepts the dry-run Passat EDC15 pack once registered, and fails it unregistered', () => {
    writeFileSync(file('src/shared/labels/packs/vagEdc15Passat.ts'), PASSAT_PACK);
    const unregistered = run(tmp);
    expect(unregistered.code).toBe(1);
    expect(unregistered.err).toContain(
      'pack "vag-edc15-038906019" is not registered in LABEL_PACKS',
    );
    registerPack('vagEdc15Passat', 'vagEdc15Passat');
    const r = run(tmp);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
  });

  it('resolves the dry-run Passat EDC15 pack by part number once registered (registry step)', () => {
    // label-pack.md step 4: `findLabelPack(partNumber)?.id` is the new pack. `LABEL_PACKS` plus the
    // pack is what registering it produces; the pack itself is not committed (illustrative only).
    const registered = [...LABEL_PACKS, PASSAT];
    expect(findLabelPackIn(registered, '038906019KQ')?.id).toBe('vag-edc15-038906019');
    expect(findLabelPackIn(registered, '038 906 019 kq')?.id).toBe('vag-edc15-038906019');
    // It does not steal the bundled packs' part numbers.
    expect(findLabelPackIn(registered, '03L906022LM')?.id).toBe('vag-edc17-03L906022');
    expect(findLabelPackIn(LABEL_PACKS, '038906019KQ')).toBeNull();
  });

  it('fails a second pack with an identical part-number prefix', () => {
    writeFileSync(
      file('src/shared/labels/packs/vagEdc17Copy.ts'),
      `import { LabelPack } from '../types';\n\n/** Illustrative duplicate. */\nexport const vagEdc17Copy: LabelPack = {\n  id: 'vag-edc17-copy',\n  module: 'EDC17 engine (copy)',\n  partNumberPrefixes: ['03L906022'],\n};\n`,
    );
    registerPack('vagEdc17Copy', 'vagEdc17Copy');
    const r = run(tmp);
    expect(r.code).toBe(1);
    // Files are read in name order, so the copy (vagEdc17Copy.ts) is seen before the original.
    expect(r.err).toContain(
      'prefix "03L906022" of "vag-edc17-03L906022" is identical to a prefix of "vag-edc17-copy" (src/shared/labels/packs/vagEdc17Copy.ts) — two packs cannot claim the same part numbers',
    );
  });

  it('fails a fixture for a vehicle without a doc, and a capture without a vehicle line', () => {
    const fixture = JSON.parse(
      readFileSync(file('src/shared/obd-core/transport/fixtures/generic/sim-connect.json'), 'utf8'),
    );
    fixture.meta.vehicleId = 'seat-leon-2010-16tdi';
    writeFileSync(
      file('src/shared/obd-core/transport/fixtures/generic/sim-connect.json'),
      JSON.stringify(fixture),
    );
    writeFileSync(file('docs/captures/no-vehicle.csv'), '# protocol: CAN\nt_ms,id,dlc,bytes\n');
    const r = run(tmp);
    expect(r.code).toBe(1);
    expect(r.err).toContain(
      'meta.vehicleId "seat-leon-2010-16tdi" has no vehicle doc (docs/vehicles/seat-leon-2010-16tdi.md)',
    );
    expect(r.err).toContain('docs/captures/no-vehicle.csv: header has no "# vehicle: <id>" line');
  });

  it('fails a vehicle doc whose id is not its file name, and GPL-sourced data', () => {
    edit('docs/vehicles/passat-b55-19tdi.md', (s) =>
      s.replace('id: passat-b55-19tdi', 'id: passat-b5'),
    );
    edit('src/shared/labels/packs/vagBcmPq35.ts', (s) =>
      s.replace("module: 'Central electrics / BCM (PQ35)'", "module: 'BCM (from python-OBD)'"),
    );
    const r = run(tmp);
    expect(r.code).toBe(1);
    expect(r.err).toContain('id "passat-b5" does not match the file name "passat-b55-19tdi.md"');
    expect(r.err).toMatch(/vagBcmPq35\.ts: mentions "python-OBD" in its data/);
  });
});
