import * as fs from 'fs';
import * as path from 'path';
import { VEHICLE_PROFILES } from '.';
import {
  carFixturesFor,
  parseFrontMatter,
  parseValidatedOnTable,
  validatedOnTableProblems,
  validationFrontMatterProblems,
} from './validatedOn';
import { readFixtureFiles } from '../obd-core/transport/fixtureFiles';
import { confirmationProblems } from './confirmation';

// docs are authoritative; this guards that code profiles stay in sync with their Markdown.
const DOCS_DIR = path.resolve(__dirname, '../../../docs/vehicles');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const repoFileExists = (rel: string) => fs.existsSync(path.join(REPO_ROOT, rel));

const readFrontMatter = (file: string) => parseFrontMatter(fs.readFileSync(file, 'utf8'));

const fixtures = readFixtureFiles();

describe('vehicle docs ↔ code sync', () => {
  for (const p of VEHICLE_PROFILES.filter((v) => v.id !== 'generic')) {
    const file = path.join(DOCS_DIR, `${p.id}.md`);

    it(`${p.id} has a matching doc with consistent front-matter`, () => {
      expect(fs.existsSync(file)).toBe(true);

      const fm = readFrontMatter(file);
      expect(fm.id).toBe(p.id);
      expect(fm.expectedProtocol).toBe(p.expectedProtocol);
      expect(Number(fm.supportedPidCount)).toBe(p.supportedPids.length);
      expect(fm.extended === 'true').toBe(Boolean(p.extendedPids && p.extendedPids.length > 0));
    });

    it(`${p.id}: an observed protocol, once recorded, is the profile's expected protocol`, () => {
      // Both fields stay empty until the car is validated; the rule itself is unit-tested below.
      expect(validationFrontMatterProblems(readFrontMatter(file), p.expectedProtocol)).toEqual([]);
    });

    it(`${p.id}: every confirmed item has a valid date and committed evidence`, () => {
      // Plan 25: `confirmed.fixture` must name a committed plan-02 fixture or docs/captures file.
      expect(confirmationProblems(p, repoFileExists)).toEqual([]);
    });

    it(`${p.id}: the "Validated on the car" table lists exactly the committed car fixtures`, () => {
      const rows = parseValidatedOnTable(fs.readFileSync(file, 'utf8'));
      expect(validatedOnTableProblems(rows, carFixturesFor(p.id, fixtures))).toEqual([]);
    });
  }

  it('the evidence directory for sniffer captures exists', () => {
    expect(repoFileExists('docs/captures/README.md')).toBe(true);
    expect(repoFileExists('docs/captures/synthetic-golf.csv')).toBe(true);
  });

  it('every vehicle doc has a registered profile', () => {
    const ids = new Set(VEHICLE_PROFILES.map((p) => p.id));
    const docs = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
    for (const f of docs) {
      expect(ids.has(f.replace(/\.md$/, ''))).toBe(true);
    }
  });
});

describe('parseValidatedOnTable', () => {
  const doc = [
    '# Car',
    '',
    '## Validated on the car',
    '',
    '| Date | App build | Adapter | Flow | Result | Fixture |',
    '| ---- | --------- | ------- | ---- | ------ | ------- |',
    '| 2026-12-01 | 0.2.0 | Vgate iCar Pro | connect | ok | `connect.json` |',
    '| 2026-12-01 | 0.2.0 | Vgate iCar Pro | faults | ok | [faults](../../src/shared/obd-core/transport/fixtures/x/faults.json) |',
    '',
    '## Next section',
    '| not | part |',
  ].join('\n');

  it('reads the data rows and the fixture names in the last column', () => {
    const rows = parseValidatedOnTable(doc);
    expect(rows?.map((r) => r.fixtures)).toEqual([['connect.json'], ['faults.json']]);
    expect(rows?.[0].cells[3]).toBe('connect');
  });

  it('the empty template has one placeholder row and no fixtures; no section → null', () => {
    const template = [
      '## Validated on the car',
      '',
      '| Date                | App build | Adapter | Flow | Result | Fixture |',
      '| ------------------- | --------- | ------- | ---- | ------ | ------- |',
      '| _not yet validated_ |           |         |      |        |         |',
    ].join('\r\n');
    expect(parseValidatedOnTable(template)).toEqual([
      { cells: ['_not yet validated_', '', '', '', '', ''], fixtures: [] },
    ]);
    expect(parseValidatedOnTable('# Car\n\nNo table.')).toBeNull();
  });
});

// The two validation rules on bad input: today every doc is still the empty template and no car
// fixture is committed, so the per-vehicle checks above would pass even if a rule were broken.
describe('validationFrontMatterProblems', () => {
  const CAN = 'ISO_15765_4_CAN_11_500';

  it('passes the empty template and a consistent validation', () => {
    expect(validationFrontMatterProblems({ observedProtocol: '', validatedOn: '' }, CAN)).toEqual(
      [],
    );
    expect(validationFrontMatterProblems({}, CAN)).toEqual([]);
    expect(
      validationFrontMatterProblems({ observedProtocol: CAN, validatedOn: '2026-12-01' }, CAN),
    ).toEqual([]);
  });

  it('flags an observed protocol that differs from the profile', () => {
    expect(
      validationFrontMatterProblems(
        { observedProtocol: 'ISO_14230_4_KWP_FAST', validatedOn: '2026-12-01' },
        CAN,
      ),
    ).toEqual([expect.stringMatching(/^observedProtocol ISO_14230_4_KWP_FAST is not/)]);
  });

  it('flags a malformed date and a field recorded without the other', () => {
    expect(
      validationFrontMatterProblems({ observedProtocol: CAN, validatedOn: '01.12.2026' }, CAN),
    ).toEqual([expect.stringMatching(/^validatedOn 01\.12\.2026 is not a YYYY-MM-DD date$/)]);
    expect(validationFrontMatterProblems({ observedProtocol: CAN }, CAN)).toEqual([
      'validatedOn and observedProtocol must be set together',
    ]);
    expect(validationFrontMatterProblems({ validatedOn: '2026-12-01' }, CAN)).toEqual([
      'validatedOn and observedProtocol must be set together',
    ]);
  });
});

describe('validatedOnTableProblems + carFixturesFor', () => {
  const GOLF = 'golf-plus-2009-20tdi';
  const ref = (vehicleDir: string, file: string, source: string) => ({
    vehicleDir,
    file,
    fixture: { meta: { source } },
  });
  const files = [
    ref(GOLF, 'connect.json', 'car'),
    ref(GOLF, 'sim-connect.json', 'simulator'),
    ref('fiat-punto-2008-12', 'faults.json', 'car'),
  ];
  const row = (fixture: string) => ({
    cells: ['2026-12-01', '', '', '', '', fixture],
    fixtures: [fixture],
  });
  const placeholder = { cells: ['_not yet validated_', '', '', '', '', ''], fixtures: [] };

  it('picks only this vehicle’s car fixtures', () => {
    expect(carFixturesFor(GOLF, files)).toEqual(['connect.json']);
    expect(carFixturesFor('passat-b55-19tdi', files)).toEqual([]);
  });

  it('passes the placeholder with no car fixtures, and a table that matches', () => {
    expect(validatedOnTableProblems([placeholder], [])).toEqual([]);
    expect(validatedOnTableProblems([row('connect.json')], carFixturesFor(GOLF, files))).toEqual(
      [],
    );
  });

  it('flags a committed car fixture with no row', () => {
    expect(validatedOnTableProblems([placeholder], carFixturesFor(GOLF, files))).toEqual([
      'car fixture connect.json is not listed in the table',
    ]);
  });

  it('flags a row naming a fixture that is not a committed car fixture', () => {
    expect(validatedOnTableProblems([row('faults.json')], [])).toEqual([
      'row names faults.json, which is not a committed car fixture',
    ]);
    // A simulator recording never counts as validation, even when a row names it.
    expect(
      validatedOnTableProblems([row('sim-connect.json')], carFixturesFor(GOLF, files)),
    ).toEqual([
      'car fixture connect.json is not listed in the table',
      'row names sim-connect.json, which is not a committed car fixture',
    ]);
  });

  it('flags a missing section or an empty table', () => {
    expect(validatedOnTableProblems(null, [])).toEqual(['no "Validated on the car" section']);
    expect(validatedOnTableProblems([], [])).toEqual([
      'the "Validated on the car" table has no rows',
    ]);
  });
});
