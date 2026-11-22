import {
  findLabelPack,
  measurementLabel,
  adaptationLabel,
  measuringGroups,
  setUserLabelPacks,
  allLabelPacks,
  LABEL_PACKS,
} from './registry';
import type { LabelPack } from './types';
import { vagEdc17Golf } from './packs/vagEdc17Golf';
import { vagBcmPq35 } from './packs/vagBcmPq35';

describe('label packs', () => {
  it('matches by part-number prefix, ignoring spacing/case', () => {
    expect(findLabelPack('03L906022LM')?.id).toBe('vag-edc17-03L906022');
    expect(findLabelPack('03l 906 022 lm')?.id).toBe('vag-edc17-03L906022');
    expect(findLabelPack('5M0920861B')).toBeNull();
    expect(findLabelPack(undefined)).toBeNull();
  });

  it('labels measurements and adaptations', () => {
    const pack = findLabelPack('03L906022LM');
    expect(measurementLabel(pack, '1702')?.name).toMatch(/soot load/i);
    expect(adaptationLabel(pack, '3001')?.unit).toBe('rpm');
    expect(measurementLabel(pack, 'FFFF')).toBeNull();
  });

  it('lists measuring groups sorted by group number', () => {
    const groups = measuringGroups(vagEdc17Golf);
    expect(groups.map(([no]) => no)).toEqual(['075', '099', '120']);
    expect(groups[0][1].dids).toEqual(['1701', '1702', '1704', '1705']);
    for (const [, g] of groups) expect(g.dids.length).toBeLessThanOrEqual(4);
  });

  it('returns a group whose DID has no measurements label (the UI falls back)', () => {
    const egr = measuringGroups(vagEdc17Golf).find(([no]) => no === '120')?.[1];
    expect(egr?.dids).toContain('170A');
    expect(measurementLabel(vagEdc17Golf, '170A')).toBeNull();
  });

  it('is empty without a pack or groups, and caps a group at four DIDs', () => {
    expect(measuringGroups(null)).toEqual([]);
    expect(measuringGroups(vagBcmPq35)).toEqual([]);
    const big = {
      ...vagEdc17Golf,
      measuringGroups: {
        '2': { name: 'b', dids: ['a1', 'a2', 'a3', 'a4', 'a5'] },
        '10': { name: 'a', dids: [] },
      },
    };
    const out = measuringGroups(big);
    expect(out.map(([no]) => no)).toEqual(['2', '10']);
    expect(out[0][1].dids).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});

describe('user label packs (plan 13)', () => {
  afterEach(() => setUserLabelPacks([]));

  const userEdc17: LabelPack = {
    id: 'user-edc17',
    module: 'EDC17 (imported)',
    partNumberPrefixes: ['03L906022'],
    adaptations: { '3001': { name: 'Idle speed offset', unit: 'rpm', description: 'Imported.' } },
  };

  it('lists user packs first, then the bundled ones', () => {
    expect(allLabelPacks()).toEqual(LABEL_PACKS);
    setUserLabelPacks([userEdc17]);
    expect(allLabelPacks().map((p) => p.id)).toEqual([
      'user-edc17',
      ...LABEL_PACKS.map((p) => p.id),
    ]);
  });

  it('a user pack with a longer prefix beats the bundled one', () => {
    setUserLabelPacks([{ ...userEdc17, id: 'longer', partNumberPrefixes: ['03L906022LM'] }]);
    expect(findLabelPack('03L906022LM')?.id).toBe('longer');
    // A part number the longer prefix does not cover still gets the bundled pack.
    expect(findLabelPack('03L906022AB')?.id).toBe('vag-edc17-03L906022');
  });

  it('a bundled pack with a longer prefix still beats a shorter user prefix', () => {
    setUserLabelPacks([{ ...userEdc17, id: 'short', partNumberPrefixes: ['03L906'] }]);
    expect(findLabelPack('03L906022LM')?.id).toBe('vag-edc17-03L906022');
    expect(findLabelPack('03L906018XX')?.id).toBe('short');
  });

  it('equal prefix → the user pack wins; the first user pack wins among user packs', () => {
    setUserLabelPacks([userEdc17]);
    const pack = findLabelPack('03L906022LM');
    expect(pack?.id).toBe('user-edc17');
    expect(adaptationLabel(pack, '3001')?.description).toBe('Imported.');
    setUserLabelPacks([{ ...userEdc17, id: 'newest' }, userEdc17]);
    expect(findLabelPack('03L906022LM')?.id).toBe('newest');
  });

  it('clearing user packs restores bundled behaviour', () => {
    setUserLabelPacks([userEdc17]);
    setUserLabelPacks([]);
    expect(findLabelPack('03L906022LM')?.id).toBe('vag-edc17-03L906022');
    expect(adaptationLabel(findLabelPack('03L906022LM'), '3001')?.description).toMatch(
      /Base idle target/,
    );
  });

  it('keeps its own copy of the list', () => {
    const list = [userEdc17];
    setUserLabelPacks(list);
    list.length = 0;
    expect(findLabelPack('03L906022LM')?.id).toBe('user-edc17');
  });
});
