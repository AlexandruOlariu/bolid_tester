/** The "Validated on the car" table every vehicle doc carries (docs/vehicles/README.md): one row
 *  per on-car flow, its last column naming the committed replay fixture
 *  (`src/shared/obd-core/transport/fixtures/<id>/<flow>.json`). Parsed by the vehicle-docs-sync and
 *  fixture-replay tests, which keep car fixtures and the doc rows in step. */

export const VALIDATED_ON_HEADING = '## Validated on the car';

export interface ValidatedOnRow {
  cells: string[];
  /** `*.json` file names referenced in the row's last column (the Fixture column). */
  fixtures: string[];
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** The table's data rows (header and separator skipped), or null when the doc has no such section. */
export function parseValidatedOnTable(markdown: string): ValidatedOnRow[] | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === VALIDATED_ON_HEADING);
  if (start < 0) return null;
  const table: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('|')) table.push(line);
    else if (table.length > 0 || line.trim().startsWith('#')) break;
  }
  return table.slice(2).map((line) => {
    const cells = splitRow(line);
    const last = cells[cells.length - 1] ?? '';
    const fixtures = last.match(/[A-Za-z0-9._-]+\.json/g) ?? [];
    return { cells, fixtures };
  });
}

/** The doc's YAML-ish front-matter (`key: value` lines between the leading `---` fences); empty
 *  values are kept as `''`. */
export function parseFrontMatter(markdown: string): Record<string, string> {
  const m = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const fm: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return fm;
}

/** The validation front-matter rule: `observedProtocol` and `validatedOn` are recorded together,
 *  from the same on-car session; once recorded, the observed protocol is the profile's
 *  `expectedProtocol` (the profile is corrected to the observation) and `validatedOn` is a
 *  `YYYY-MM-DD` date. Returns one message per violation (empty = the rule holds; also when neither
 *  field is set yet). */
export function validationFrontMatterProblems(
  fm: Record<string, string>,
  expectedProtocol: string,
): string[] {
  const problems: string[] = [];
  const observed = fm.observedProtocol ?? '';
  const date = fm.validatedOn ?? '';
  if (observed && observed !== expectedProtocol) {
    problems.push(
      `observedProtocol ${observed} is not the profile's expectedProtocol ${expectedProtocol}`,
    );
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    problems.push(`validatedOn ${date} is not a YYYY-MM-DD date`);
  }
  if (Boolean(date) !== Boolean(observed)) {
    problems.push('validatedOn and observedProtocol must be set together');
  }
  return problems;
}

/** Just enough of a committed fixture file (`fixtureFiles.ts` → `FixtureFile`) for the rule below. */
export interface FixtureFileRef {
  vehicleDir: string;
  file: string;
  fixture: { meta?: { source?: string } };
}

/** File names of the car fixtures (`meta.source: 'car'`) committed under `fixtures/<vehicleId>/`. */
export function carFixturesFor(vehicleId: string, files: FixtureFileRef[]): string[] {
  return files
    .filter((f) => f.vehicleDir === vehicleId && f.fixture.meta?.source === 'car')
    .map((f) => f.file);
}

/** The "Validated on the car" rule: the section exists with at least one row (the placeholder
 *  until the car is validated), every committed car fixture is named in a row, and every fixture a
 *  row names is a committed car fixture. Returns one message per violation (empty = in step). */
export function validatedOnTableProblems(
  rows: ValidatedOnRow[] | null,
  carFixtures: string[],
): string[] {
  if (rows === null) return [`no "${VALIDATED_ON_HEADING.slice(3)}" section`];
  if (rows.length === 0) return ['the "Validated on the car" table has no rows'];
  const referenced = new Set(rows.flatMap((r) => r.fixtures));
  const problems: string[] = [];
  for (const f of carFixtures) {
    if (!referenced.has(f)) problems.push(`car fixture ${f} is not listed in the table`);
  }
  for (const ref of referenced) {
    if (!carFixtures.includes(ref))
      problems.push(`row names ${ref}, which is not a committed car fixture`);
  }
  return problems;
}

/** Both validation rules on one vehicle doc, exactly as `vehicle-docs-sync.test.ts` applies them to
 *  every doc: the front-matter rule (`validationFrontMatterProblems`) and the "Validated on the
 *  car" table rule (`validatedOnTableProblems`) against the car fixtures committed for that
 *  vehicle. One pure function, so the synthetic-input tests prove the same path that guards the
 *  real docs fails on bad data. Empty = the doc is in step. */
export function vehicleDocValidationProblems(
  markdown: string,
  expectedProtocol: string,
  carFixtures: string[],
): string[] {
  return [
    ...validationFrontMatterProblems(parseFrontMatter(markdown), expectedProtocol),
    ...validatedOnTableProblems(parseValidatedOnTable(markdown), carFixtures),
  ];
}
