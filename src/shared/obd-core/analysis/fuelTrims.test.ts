import { assessFuelTrims, TRIM_LIMIT_PCT, VACUUM_LEAK_DROP_PCT } from './fuelTrims';

describe('assessFuelTrims', () => {
  it('lean at idle that improves at 2500 rpm is a vacuum leak', () =>
    expect(
      assessFuelTrims(
        { stftPct: 12.5, ltftPct: 18, rpm: 820 },
        { stftPct: 3.1, ltftPct: 9.4, rpm: 2500 },
      ),
    ).toMatchObject({
      pattern: 'vacuum_leak',
      severity: 'warn',
      idleTotalPct: 30.5,
      holdTotalPct: 12.5,
    }));
  it('lean at both speeds points at the MAF or fuel delivery', () =>
    expect(
      assessFuelTrims({ stftPct: 6, ltftPct: 8, rpm: 820 }, { stftPct: 7, ltftPct: 8, rpm: 2500 })
        .pattern,
    ).toBe('lean_all_speeds'));
  it('rich', () =>
    expect(assessFuelTrims({ stftPct: -6, ltftPct: -7, rpm: 820 }, null).pattern).toBe('rich'));
  it('normal', () =>
    expect(assessFuelTrims({ stftPct: 1, ltftPct: -2, rpm: 820 }, null)).toMatchObject({
      pattern: 'ok',
      severity: 'ok',
    }));
  it('a missing trim is insufficient, never a verdict', () =>
    expect(assessFuelTrims({ stftPct: null, ltftPct: 18, rpm: 820 }, null)).toMatchObject({
      pattern: 'insufficient',
      severity: 'info',
    }));

  it('exports the thresholds', () => {
    expect(TRIM_LIMIT_PCT).toBe(10);
    expect(VACUUM_LEAK_DROP_PCT).toBe(5);
  });

  it('lean at idle without a hold is lean', () =>
    expect(assessFuelTrims({ stftPct: 4, ltftPct: 6, rpm: 820 }, null)).toMatchObject({
      pattern: 'lean',
      severity: 'warn',
      idleTotalPct: 10,
      holdTotalPct: null,
    }));

  it('a hold that lost a trim (NO DATA) still judges the idle part and says so', () => {
    const r = assessFuelTrims(
      { stftPct: 12.5, ltftPct: 18, rpm: 820 },
      { stftPct: null, ltftPct: 9.4, rpm: 2500 },
    );
    expect(r).toMatchObject({ pattern: 'lean', severity: 'warn', holdTotalPct: null });
    expect(r.notes.join(' ')).toMatch(/hold/i);
  });

  it('rich at the hold only is rich', () =>
    expect(
      assessFuelTrims({ stftPct: 1, ltftPct: 1, rpm: 820 }, { stftPct: -5, ltftPct: -5, rpm: 2500 })
        .pattern,
    ).toBe('rich'));

  it('lean at idle that improves by less than the drop is lean, not a leak', () =>
    expect(
      assessFuelTrims({ stftPct: 6, ltftPct: 6, rpm: 820 }, { stftPct: 4, ltftPct: 5, rpm: 2500 })
        .pattern,
    ).toBe('lean'));

  it('lean at both speeds with a large improvement at the hold is still a vacuum leak', () =>
    expect(
      assessFuelTrims({ stftPct: 10, ltftPct: 10, rpm: 820 }, { stftPct: 5, ltftPct: 6, rpm: 2500 })
        .pattern,
    ).toBe('vacuum_leak'));

  it('notes are model-facing English text', () => {
    const r = assessFuelTrims(
      { stftPct: 12.5, ltftPct: 18, rpm: 820 },
      { stftPct: 3.1, ltftPct: 9.4, rpm: 2500 },
    );
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.notes.join(' ')).toMatch(/vacuum leak/i);
  });
});
