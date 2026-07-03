import { findLabelPack, measurementLabel, adaptationLabel } from './registry';

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
});
