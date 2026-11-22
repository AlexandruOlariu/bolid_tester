import * as fs from 'fs';
import * as path from 'path';

// docs/README.md: "each features/*.md maps 1:1 to a feature slice in src/features/*". This keeps it
// true: a new slice without a spec, or a spec whose slice was deleted, fails CI.
const FEATURES_DIR = path.resolve(__dirname, '../../features');
const DOCS_DIR = path.resolve(__dirname, '../../../docs/features');

/** Slices whose spec has another name. */
const ALIASES: Record<string, string> = {
  inspection: 'used-car-inspection',
  maintenance: 'maintenance-log',
};

/** Slices that need no spec. Keep empty; add an entry only with a comment saying why. */
const NO_SPEC_NEEDED = new Set<string>([]);

/** Specs that document shared code rather than a slice. `tp20`: the VW TP2.0 transport in
 *  `shared/obd-core/tp20`, used by module-scan. */
const KNOWN_SHARED = new Set<string>(['tp20']);

interface SyncRules {
  aliases: Record<string, string>;
  noSpecNeeded: Set<string>;
  knownShared: Set<string>;
}

const RULES: SyncRules = {
  aliases: ALIASES,
  noSpecNeeded: NO_SPEC_NEEDED,
  knownShared: KNOWN_SHARED,
};

/** One message per broken link between slices (dir names) and specs (file names without `.md`). */
function featureDocsProblems(slices: string[], specs: string[], rules: SyncRules): string[] {
  const problems: string[] = [];
  const specSet = new Set(specs);
  const covered = new Set<string>();
  for (const slice of slices) {
    if (rules.noSpecNeeded.has(slice)) continue;
    const spec = rules.aliases[slice] ?? slice;
    covered.add(spec);
    if (!specSet.has(spec)) problems.push(`src/features/${slice} has no docs/features/${spec}.md`);
  }
  for (const spec of specs) {
    if (covered.has(spec) || rules.knownShared.has(spec)) continue;
    problems.push(`docs/features/${spec}.md has no slice in src/features`);
  }
  for (const [slice, spec] of Object.entries(rules.aliases)) {
    if (!slices.includes(slice)) problems.push(`alias ${slice} → ${spec}: no such slice`);
  }
  return problems;
}

const listSlices = () =>
  fs
    .readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

const listSpecs = () =>
  fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));

describe('feature docs ↔ slices sync', () => {
  it('every slice has a spec and every spec has a slice', () => {
    expect(featureDocsProblems(listSlices(), listSpecs(), RULES)).toEqual([]);
  });

  // Named slices, not a count: plans delete slices (plan 07 removes sensor-readings), and a
  // hard-coded minimum would go red for an unrelated reason.
  it('sees the real tree (guards against an empty glob passing vacuously)', () => {
    expect(listSlices()).toEqual(expect.arrayContaining(['engine-host', 'more', 'connection']));
    expect(listSpecs()).toEqual(expect.arrayContaining(['engine-host', 'more', 'connection']));
  });
});

describe('featureDocsProblems', () => {
  const rules: SyncRules = {
    aliases: { inspection: 'used-car-inspection' },
    noSpecNeeded: new Set(['scratch']),
    knownShared: new Set(['tp20']),
  };

  it('accepts aliases, exempt slices and shared specs', () => {
    expect(
      featureDocsProblems(
        ['alerts', 'inspection', 'scratch'],
        ['alerts', 'used-car-inspection', 'tp20'],
        rules,
      ),
    ).toEqual([]);
  });

  it('reports a slice whose spec was deleted', () => {
    expect(
      featureDocsProblems(['alerts', 'inspection'], ['used-car-inspection', 'tp20'], rules),
    ).toEqual(['src/features/alerts has no docs/features/alerts.md']);
  });

  it('reports an aliased slice whose spec is missing (not its slug)', () => {
    expect(featureDocsProblems(['inspection'], ['inspection'], rules)).toEqual([
      'src/features/inspection has no docs/features/used-car-inspection.md',
      'docs/features/inspection.md has no slice in src/features',
    ]);
  });

  it('reports a spec whose slice was deleted, and a stale alias', () => {
    expect(featureDocsProblems(['alerts'], ['alerts', 'used-car-inspection'], rules)).toEqual([
      'docs/features/used-car-inspection.md has no slice in src/features',
      'alias inspection → used-car-inspection: no such slice',
    ]);
  });
});
