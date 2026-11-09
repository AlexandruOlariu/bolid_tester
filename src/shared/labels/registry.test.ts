import { findLabelPack, measurementLabel, adaptationLabel, measuringGroups } from './registry';
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
