/** Community contribution checks (plan 33): the pure rules behind `scripts/validate-contrib.mjs`,
 *  which CI runs in `verify` (`npm run validate:contrib`). The script reads the repository (vehicle
 *  docs, replay fixtures, label packs, DTC tables, sniffer captures), evaluates the TypeScript data
 *  files and hands plain values to these functions; each returns one `ContribProblem` per finding.
 *  No file system, no React Native — core scope, unit-tested in `contribChecks.test.ts`.
 *  Contributor guide: CONTRIBUTING.md and docs/contributing/. */
import { parseFrontMatter, vehicleDocValidationProblems } from '../vehicles/validatedOn';

export type ContribArea =
  | 'vehicle-docs'
  | 'fixtures'
  | 'label-packs'
  | 'dtc-database'
  | 'captures'
  | 'licence';

export type ContribLevel = 'error' | 'warning';

export interface ContribProblem {
  area: ContribArea;
  /** `error` fails the check (exit 1); `warning` is printed and passes. */
  level: ContribLevel;
  /** Repo-relative path, forward slashes. */
  file: string;
  message: string;
}

/** Report headings, in report order. */
export const CONTRIB_AREA_TITLES: Record<ContribArea, string> = {
  'vehicle-docs': 'Vehicle docs (docs/vehicles)',
  fixtures: 'Replay fixtures (src/shared/obd-core/transport/fixtures)',
  'label-packs': 'Label packs (src/shared/labels/packs)',
  'dtc-database': 'DTC database (src/shared/obd-core/obd/dtcDatabase)',
  captures: 'Sniffer captures (docs/captures)',
  licence: 'Licence hygiene',
};

const problem =
  (area: ContribArea, level: ContribLevel) =>
  (file: string, message: string): ContribProblem => ({ area, level, file, message });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const baseName = (file: string): string => file.split(/[\\/]/).pop() ?? file;

// ------------------------------------------------------------------------------- vehicle docs

/** Front-matter keys every registry vehicle doc must fill (docs/vehicles/README.md). */
export const REQUIRED_VEHICLE_DOC_KEYS = [
  'id',
  'name',
  'expectedProtocol',
  'supportedPidCount',
  'extended',
] as const;

/** Registry ids are kebab-case (`golf-plus-2009-20tdi`). */
export const VEHICLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One `docs/vehicles/<id>.md`: the front-matter has the required keys, `id` is the file name,
 *  the protocols are known `ProtocolId`s, the counts parse, and both validation rules
 *  (`vehicleDocValidationProblems`: observed protocol and date recorded together, the "Validated
 *  on the car" table listing exactly the vehicle's committed car fixtures) hold. */
export function checkVehicleDoc(
  file: string,
  markdown: string,
  protocolIds: readonly string[],
  /** The vehicle's committed car fixtures (`meta.source: 'car'`), file names only: required, so a
   *  caller cannot silently check the "Validated on the car" table against an empty list. */
  carFixtures: readonly string[],
): ContribProblem[] {
  const error = problem('vehicle-docs', 'error');
  const fm = parseFrontMatter(markdown);
  if (Object.keys(fm).length === 0) {
    return [error(file, 'has no front-matter (the `---` block at the top of the file)')];
  }
  const out: ContribProblem[] = [];
  for (const key of REQUIRED_VEHICLE_DOC_KEYS) {
    if (!fm[key]) out.push(error(file, `front-matter is missing "${key}"`));
  }
  const expectedName = baseName(file).replace(/\.md$/, '');
  if (fm.id) {
    if (fm.id !== expectedName) {
      out.push(error(file, `id "${fm.id}" does not match the file name "${expectedName}.md"`));
    }
    if (!VEHICLE_ID_PATTERN.test(fm.id)) {
      out.push(error(file, `id "${fm.id}" is not kebab-case (lower-case letters, digits, "-")`));
    }
  }
  for (const key of ['expectedProtocol', 'observedProtocol']) {
    const value = fm[key];
    if (value && !protocolIds.includes(value)) {
      out.push(
        error(file, `${key} "${value}" is not a known protocol (one of ${protocolIds.join(', ')})`),
      );
    }
  }
  if (fm.supportedPidCount && !/^\d+$/.test(fm.supportedPidCount)) {
    out.push(error(file, `supportedPidCount "${fm.supportedPidCount}" is not a whole number`));
  }
  if (fm.extended && fm.extended !== 'true' && fm.extended !== 'false') {
    out.push(error(file, `extended "${fm.extended}" must be true or false`));
  }
  if (fm.expectedProtocol) {
    for (const message of vehicleDocValidationProblems(markdown, fm.expectedProtocol, [
      ...carFixtures,
    ])) {
      out.push(error(file, message));
    }
  }
  return out;
}

// ----------------------------------------------------------------------------------- fixtures

/** A replay fixture is one recorded flow, not a whole session. */
export const MAX_FIXTURE_BYTES = 200 * 1024;

/** One `fixtures/<vehicleId>/<flow>.json` (plan 02 format): parses, has `pairs`, a `meta` whose
 *  `vehicleId` names a vehicle (a doc, or the built-in `generic`) and matches its folder, a
 *  non-empty `flow`, a `source` of `car` / `simulator`, and is at most 200 KB.
 *  `rel` is `<vehicleId>/<file>`. */
export function checkFixtureFile(
  rel: string,
  text: string,
  sizeBytes: number,
  knownVehicleIds: readonly string[],
): ContribProblem[] {
  const error = problem('fixtures', 'error');
  const out: ContribProblem[] = [];
  if (sizeBytes > MAX_FIXTURE_BYTES) {
    out.push(
      error(
        rel,
        `is ${Math.ceil(sizeBytes / 1024)} KB; a fixture may be at most ${MAX_FIXTURE_BYTES / 1024} KB (trim it to one flow)`,
      ),
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    out.push(error(rel, `is not valid JSON (${e instanceof Error ? e.message : String(e)})`));
    return out;
  }
  if (!isRecord(parsed)) return [...out, error(rel, 'is not a JSON object')];
  if (!isRecord(parsed.pairs)) out.push(error(rel, 'has no "pairs" object (command → response)'));
  const meta = parsed.meta;
  if (!isRecord(meta)) {
    out.push(error(rel, 'has no "meta" object (source, vehicleId, flow)'));
    return out;
  }
  const folder = rel.includes('/') ? rel.split('/')[0] : null;
  if (!nonEmptyString(meta.vehicleId)) {
    out.push(error(rel, 'meta.vehicleId is missing'));
  } else {
    if (!knownVehicleIds.includes(meta.vehicleId)) {
      out.push(
        error(
          rel,
          `meta.vehicleId "${meta.vehicleId}" has no vehicle doc (docs/vehicles/${meta.vehicleId}.md)`,
        ),
      );
    }
    if (folder && folder !== meta.vehicleId) {
      out.push(
        error(rel, `lives in fixtures/${folder}/ but meta.vehicleId is "${meta.vehicleId}"`),
      );
    }
  }
  if (!nonEmptyString(meta.flow)) out.push(error(rel, 'meta.flow is missing or empty'));
  if (meta.source !== 'car' && meta.source !== 'simulator') {
    out.push(error(rel, 'meta.source must be "car" or "simulator"'));
  }
  return out;
}

// -------------------------------------------------------------------------------- label packs

/** Label-pack DID keys: four upper-case hex digits ('1701', 'F1A0'). */
export const DID_PATTERN = /^[0-9A-F]{4}$/;

/** Label-pack ids: `<make>-<module>-<partPrefix>`, letters / digits joined by "-". */
export const LABEL_PACK_ID_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** VCDS group numbers: one to three digits ('001', '75', '121'). */
const GROUP_NUMBER_PATTERN = /^\d{1,3}$/;

/** One exported pack and the file it came from. `pack` is unvalidated (evaluated from TS). */
export interface LabelPackEntry {
  file: string;
  pack: unknown;
}

const normalisePrefix = (p: string): string => p.replace(/\s+/g, '').toUpperCase();

function checkLabelMap(file: string, section: string, value: unknown, out: ContribProblem[]) {
  const error = problem('label-packs', 'error');
  if (value === undefined) return;
  if (!isRecord(value)) {
    out.push(error(file, `${section} must be an object keyed by DID`));
    return;
  }
  for (const [did, label] of Object.entries(value)) {
    if (!DID_PATTERN.test(did)) {
      out.push(error(file, `${section}: DID key "${did}" is not four upper-case hex digits`));
    }
    if (!isRecord(label) || !nonEmptyString(label.name)) {
      out.push(error(file, `${section}.${did} has no name`));
    } else if (label.unit !== undefined && typeof label.unit !== 'string') {
      out.push(error(file, `${section}.${did}.unit must be a string`));
    }
  }
}

function checkCodingBits(file: string, id: string, value: unknown, out: ContribProblem[]) {
  const error = problem('label-packs', 'error');
  if (value === undefined) return;
  if (!isRecord(value)) {
    out.push(error(file, `${id}.codingBits must be an object keyed by coding DID`));
    return;
  }
  for (const [did, bits] of Object.entries(value)) {
    if (!DID_PATTERN.test(did)) {
      out.push(error(file, `${id}.codingBits: DID key "${did}" is not four upper-case hex digits`));
    }
    if (!Array.isArray(bits)) {
      out.push(error(file, `${id}.codingBits.${did} must be a list`));
      continue;
    }
    for (const b of bits) {
      const ok =
        isRecord(b) &&
        typeof b.byte === 'number' &&
        Number.isInteger(b.byte) &&
        b.byte >= 0 &&
        (b.bit === undefined ||
          (typeof b.bit === 'number' && Number.isInteger(b.bit) && b.bit >= 0 && b.bit <= 7)) &&
        nonEmptyString(b.name);
      if (!ok) {
        out.push(
          error(
            file,
            `${id}.codingBits.${did}: every entry needs a byte ≥ 0, a bit 0–7 and a name`,
          ),
        );
      }
    }
  }
}

function checkMeasuringGroups(file: string, id: string, value: unknown, out: ContribProblem[]) {
  const error = problem('label-packs', 'error');
  if (value === undefined) return;
  if (!isRecord(value)) {
    out.push(error(file, `${id}.measuringGroups must be an object keyed by group number`));
    return;
  }
  for (const [no, group] of Object.entries(value)) {
    const where = `${id}.measuringGroups.${no}`;
    if (!GROUP_NUMBER_PATTERN.test(no)) {
      out.push(error(file, `${where}: group number must be one to three digits`));
    }
    if (!isRecord(group) || !nonEmptyString(group.name) || !Array.isArray(group.dids)) {
      out.push(error(file, `${where} needs a name and a dids list`));
      continue;
    }
    if (group.dids.length > 4) out.push(error(file, `${where} has more than four DIDs`));
    const seen = new Set<string>();
    for (const did of group.dids) {
      if (typeof did !== 'string' || !DID_PATTERN.test(did)) {
        out.push(error(file, `${where}: DID "${String(did)}" is not four upper-case hex digits`));
      } else if (seen.has(did)) {
        out.push(error(file, `${where}: DID ${did} is listed twice`));
      }
      if (typeof did === 'string') seen.add(did);
    }
  }
}

function checkOnePack(file: string, pack: Record<string, unknown>, out: ContribProblem[]) {
  const error = problem('label-packs', 'error');
  const id = nonEmptyString(pack.id) ? pack.id : '(no id)';
  if (!nonEmptyString(pack.id)) out.push(error(file, 'pack has no id'));
  else if (!LABEL_PACK_ID_PATTERN.test(pack.id)) {
    out.push(error(file, `id "${pack.id}" must be letters / digits joined by "-"`));
  }
  if (!nonEmptyString(pack.module)) out.push(error(file, `${id}: module (display name) is empty`));
  const prefixes = pack.partNumberPrefixes;
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    out.push(error(file, `${id}: partNumberPrefixes must list at least one part-number prefix`));
  } else {
    const seen = new Set<string>();
    for (const p of prefixes) {
      if (!nonEmptyString(p)) {
        out.push(error(file, `${id}: a part-number prefix is empty`));
        continue;
      }
      if (/\s/.test(p)) out.push(error(file, `${id}: prefix "${p}" contains spaces`));
      const n = normalisePrefix(p);
      if (seen.has(n)) out.push(error(file, `${id}: prefix "${p}" is listed twice`));
      seen.add(n);
    }
  }
  checkLabelMap(file, `${id}.measurements`, pack.measurements, out);
  checkLabelMap(file, `${id}.adaptations`, pack.adaptations, out);
  checkCodingBits(file, id, pack.codingBits, out);
  checkMeasuringGroups(file, id, pack.measuringGroups, out);
}

/** Every bundled pack: its fields (id, module, prefixes, DID keys, names, groups), ids unique,
 *  no prefix claimed by two packs (an identical prefix is an error; one prefix inside another is
 *  a warning — the longer prefix wins for its part numbers, which may be intended), and every
 *  pack registered in `LABEL_PACKS`. */
export function checkLabelPacks(
  entries: readonly LabelPackEntry[],
  registeredIds: readonly string[],
): ContribProblem[] {
  const error = problem('label-packs', 'error');
  const warning = problem('label-packs', 'warning');
  const out: ContribProblem[] = [];
  const ids = new Map<string, string>();
  const owners: { prefix: string; id: string; file: string }[] = [];
  for (const { file, pack } of entries) {
    if (!isRecord(pack)) {
      out.push(error(file, 'exports a pack that is not an object'));
      continue;
    }
    checkOnePack(file, pack, out);
    if (!nonEmptyString(pack.id)) continue;
    const id = pack.id;
    const other = ids.get(id);
    if (other !== undefined) out.push(error(file, `pack id "${id}" is also used in ${other}`));
    ids.set(id, file);
    if (!registeredIds.includes(id)) {
      out.push(
        error(
          file,
          `pack "${id}" is not registered in LABEL_PACKS (src/shared/labels/registry.ts)`,
        ),
      );
    }
    if (!Array.isArray(pack.partNumberPrefixes)) continue;
    const own = new Set<string>();
    for (const p of pack.partNumberPrefixes) if (nonEmptyString(p)) own.add(normalisePrefix(p));
    for (const prefix of own) {
      for (const prev of owners) {
        if (prev.id === id) continue;
        if (prev.prefix === prefix) {
          out.push(
            error(
              file,
              `prefix "${prefix}" of "${id}" is identical to a prefix of "${prev.id}" (${prev.file}) — two packs cannot claim the same part numbers`,
            ),
          );
        } else if (prefix.startsWith(prev.prefix) || prev.prefix.startsWith(prefix)) {
          const mine = `"${prefix}" (${id})`;
          const theirs = `"${prev.prefix}" (${prev.id})`;
          const [longer, shorter] =
            prefix.length > prev.prefix.length ? [mine, theirs] : [theirs, mine];
          out.push(
            warning(
              file,
              `prefix ${longer} overlaps ${shorter}: the longer prefix wins for its part numbers`,
            ),
          );
        }
      }
      owners.push({ prefix, id, file });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------ DTC database

/** SAE-format DTC keys, the same pattern as `DTC_CODE_PATTERN` in `obd/dtcDatabase` (kept local
 *  so the validator does not load the whole database; the test asserts they agree). */
export const SAE_DTC_KEY_PATTERN = /^[PCBU][0-9A-F]{4}$/;

/** VAG native KWP fault numbers (the VCDS 5-digit codes) in `VAG_DTC_TEXTS`. */
export const VAG_NATIVE_KEY_PATTERN = /^\d{5}$/;

/** Exported tables whose name ends in `_TEXTS` hold native 5-digit fault numbers; every other
 *  table is keyed by SAE code. */
export const isNativeDtcTable = (exportName: string): boolean => /_TEXTS$/.test(exportName);

/** One exported text table of one DTC data file. */
export interface DtcTableEntry {
  file: string;
  exportName: string;
  table: Record<string, unknown>;
}

/** The DTC data tables: keys match their number space, descriptions are non-empty, and no code
 *  appears in two tables (SAE codes across all SAE tables, native numbers across native tables). */
export function checkDtcTables(tables: readonly DtcTableEntry[]): ContribProblem[] {
  const error = problem('dtc-database', 'error');
  const out: ContribProblem[] = [];
  const seen = { sae: new Map<string, string>(), native: new Map<string, string>() };
  for (const { file, exportName, table } of tables) {
    const native = isNativeDtcTable(exportName);
    const pattern = native ? VAG_NATIVE_KEY_PATTERN : SAE_DTC_KEY_PATTERN;
    const owners = native ? seen.native : seen.sae;
    const here = `${file} (${exportName})`;
    for (const [code, text] of Object.entries(table)) {
      if (!pattern.test(code)) {
        out.push(
          error(
            file,
            native
              ? `${exportName}: key "${code}" is not a 5-digit VAG fault number`
              : `${exportName}: key "${code}" is not an upper-case SAE code like P0101`,
          ),
        );
      }
      if (!nonEmptyString(text)) {
        out.push(error(file, `${exportName}.${code} has an empty description`));
      }
      const prev = owners.get(code);
      if (prev !== undefined) {
        out.push(error(file, `${code} is defined in both ${prev} and ${here}`));
      } else {
        owners.set(code, here);
      }
    }
  }
  return out;
}

/** A DTC data file's header comment must carry a `License:` line naming the licence of its texts
 *  (MIT when authored for the project, or the cited source's MIT / BSD / public-domain licence). */
export function checkDtcFileHeader(file: string, source: string): ContribProblem[] {
  if (/^[\s*/]*Licen[cs]e:\s*\S/im.test(leadingComment(source))) return [];
  return [
    problem('dtc-database', 'error')(
      file,
      'file header has no "License:" line (e.g. "License: MIT — authored for bolid-tester")',
    ),
  ];
}

/** Keys at the start of a line (`  P0101: '…',` or `'00532': '…'`) that appear more than once in
 *  one source file — the evaluated object would silently keep only the last one. */
export function duplicateKeysInSource(source: string): string[] {
  const counts = new Map<string, number>();
  const re = /^\s*['"]?([PCBU][0-9A-F]{4}|\d{5})['"]?\s*:/gm;
  for (const m of stripComments(source).matchAll(re)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([k]) => k);
}

// ---------------------------------------------------------------------------------- captures

/** One committed sniffer CSV: the leading `#` header block names the vehicle with
 *  `# vehicle: <registry id>` (the Bus sniffer writes it; docs/captures/README.md). */
export function checkCapture(
  rel: string,
  text: string,
  knownVehicleIds: readonly string[],
): ContribProblem[] {
  const error = problem('captures', 'error');
  const header: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('#')) break;
    header.push(line);
  }
  if (header.length === 0) {
    return [error(rel, 'has no "#" header block — share the CSV from the Bus sniffer')];
  }
  const vehicleLine = header.find((l) => /^#\s*vehicle:/i.test(l));
  if (!vehicleLine) return [error(rel, 'header has no "# vehicle: <id>" line')];
  const id = vehicleLine.replace(/^#\s*vehicle:/i, '').trim();
  if (!knownVehicleIds.includes(id)) {
    return [error(rel, `"# vehicle: ${id}" is not a registry vehicle id`)];
  }
  return [];
}

// ---------------------------------------------------------------------------- licence hygiene

/** Names that must never appear as a source or licence of contributed data: GPL-family licences
 *  and the GPL-licensed python-OBD / pyOBD code lists (plan 05 sourcing rule). */
export const FORBIDDEN_SOURCE_PATTERN = /\b[AL]?GPL\b|python-?obd|\bpyobd\b/i;

/** A contributed data file (profile, label pack, DTC table) may WARN about GPL sources in prose
 *  comments, but GPL / python-OBD / pyOBD must not appear in the data itself (strings, keys) nor
 *  as the value of a `Source:` / `License:` line. */
export function checkLicenceHygiene(file: string, source: string): ContribProblem[] {
  const error = problem('licence', 'error');
  const out: ContribProblem[] = [];
  const inCode = stripComments(source).match(FORBIDDEN_SOURCE_PATTERN);
  if (inCode) {
    out.push(
      error(
        file,
        `mentions "${inCode[0]}" in its data — GPL-licensed code lists (python-OBD, pyOBD) are off-limits`,
      ),
    );
  }
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/\b(Source|Licen[cs]e)\s*:\s*(.*)$/i);
    const hit = m?.[2].match(FORBIDDEN_SOURCE_PATTERN);
    if (m && hit) {
      out.push(
        error(
          file,
          `its ${m[1]} line names "${hit[0]}" — contributed data must not come from GPL sources`,
        ),
      );
    }
  }
  return out;
}

// ------------------------------------------------------------------------------ source helpers

/** The source with line and block comments removed; string and template literals are kept (a
 *  `//` inside a string is not a comment). Line breaks are kept so line-anchored scans still
 *  work. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i] + source[i + 1];
          i += 2;
        } else {
          out += source[i];
          i++;
        }
      }
      if (i < n) out += source[i];
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The file's leading comment (a block comment, or consecutive `//` lines), or ''. */
export function leadingComment(source: string): string {
  const trimmed = source
    .replace(/^\uFEFF/, '')
    .replace(/^#![^\n]*\n/, '')
    .trimStart();
  if (trimmed.startsWith('/*')) {
    const end = trimmed.indexOf('*/');
    return end < 0 ? trimmed : trimmed.slice(0, end + 2);
  }
  const lines: string[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('//')) break;
    lines.push(line);
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------ report

export const hasContribErrors = (problems: readonly ContribProblem[]): boolean =>
  problems.some((p) => p.level === 'error');

/** A readable report grouped by area (errors before warnings within an area). */
export function formatContribReport(
  problems: readonly ContribProblem[],
  filesChecked: number,
): string {
  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.length - errors;
  const lines = [
    errors > 0
      ? `Contribution checks FAILED: ${errors} error(s), ${warnings} warning(s) in ${filesChecked} file(s).`
      : `Contribution checks passed: ${filesChecked} file(s), ${warnings} warning(s).`,
  ];
  for (const area of Object.keys(CONTRIB_AREA_TITLES) as ContribArea[]) {
    const inArea = problems
      .filter((p) => p.area === area)
      .sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
    if (inArea.length === 0) continue;
    lines.push('', CONTRIB_AREA_TITLES[area]);
    for (const p of inArea) {
      lines.push(`  ${p.level === 'error' ? 'error  ' : 'warning'} ${p.file}: ${p.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
