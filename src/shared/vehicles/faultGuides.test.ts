import { findFaultGuides, matchFaultGuide, GENERIC_GUIDE } from './faultGuides';

const GOLF = 'golf-plus-2009-20tdi';

describe('matchFaultGuide', () => {
  it('matches an exact generic P-code (EGR) with its DIDs and routine', () => {
    const g = matchFaultGuide(GOLF, 'P0401');
    expect(g.relatedDids).toContain('1708');
    expect(g.routineId).toBe('0130');
    expect(g.freezeFrame).toBe(true);
  });

  it('matches by VAG 5-digit code (P2015 ↔ 08213)', () => {
    const byVag = matchFaultGuide(GOLF, 'PXXXX', '08213');
    expect(byVag.routineId).toBe('0301');
    expect(byVag.relatedDids).toEqual(['170E', '170F']);
  });

  it('matches a code family by prefix', () => {
    // P0407 has no exact entry but is in the P040 EGR family.
    const g = matchFaultGuide(GOLF, 'P0407');
    expect(g.routineId).toBe('0130');
  });

  it('is case-insensitive on the code', () => {
    expect(matchFaultGuide(GOLF, 'p0299').routineId).toBe('0301');
  });

  it('returns a note-only guide (no DIDs/routine) for glow plugs', () => {
    const g = matchFaultGuide(GOLF, 'P0380');
    expect(g.relatedDids).toBeUndefined();
    expect(g.routineId).toBeUndefined();
    expect(g.freezeFrame).toBe(true);
    expect(g.note).toMatch(/glow/i);
  });

  it('falls back to the generic guide for an unmatched code', () => {
    const g = matchFaultGuide(GOLF, 'P0128');
    expect(g).toBe(GENERIC_GUIDE);
    expect(g.freezeFrame).toBe(true);
  });

  it('falls back to the generic guide for a profile with no curated guides', () => {
    expect(matchFaultGuide('fiat-punto-2008-12', 'P0401')).toBe(GENERIC_GUIDE);
    expect(matchFaultGuide('generic', 'P2002')).toBe(GENERIC_GUIDE);
  });
});

describe('findFaultGuides', () => {
  it('finds the guides whose note mentions every word of the topic, case-insensitively', () => {
    const egr = findFaultGuides(GOLF, 'EGR');
    expect(egr).toHaveLength(1);
    expect(egr[0].guide).toBe(matchFaultGuide(GOLF, 'P0401'));
    expect(egr[0].codes).toContain('P0401');
    expect(egr[0].prefix).toBe('P040');
    expect(findFaultGuides(GOLF, 'intake flap').map((e) => e.codes[0])).toEqual(['P0299', 'P2015']);
  });

  it('matches the codes a guide covers too', () => {
    expect(findFaultGuides(GOLF, 'p2183').map((e) => e.guide)).toEqual([
      matchFaultGuide(GOLF, 'P2183'),
    ]);
  });

  it('finds nothing for a blank topic, an unknown topic or a profile without guides', () => {
    expect(findFaultGuides(GOLF, '  ')).toEqual([]);
    expect(findFaultGuides(GOLF, 'sunroof')).toEqual([]);
    expect(findFaultGuides('fiat-punto-2008-12', 'egr')).toEqual([]);
  });
});
