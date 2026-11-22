import { trendOf } from './digest';

describe('trendOf', () => {
  it.each([
    [[1, 1, 1, 5, 5, 5], 'rising'],
    [[5, 5, 5, 1, 1, 1], 'falling'],
    [[100, 101, 100, 101, 100, 101], 'steady'],
  ])('trendOf(%j) = %s', (v, t) => expect(trendOf(v)).toBe(t));

  it('needs a change of at least 1 or 5 % of the mean', () => {
    // mean 1000: a 40-unit drift is under 5 % (50), so steady; 60 is over it.
    expect(trendOf([980, 980, 1000, 1000, 1020, 1020])).toBe('steady');
    expect(trendOf([970, 970, 1000, 1000, 1030, 1030])).toBe('rising');
    // near zero the floor is 1: 0.5 is noise, 1.5 is a trend.
    expect(trendOf([0, 0, 0.5, 0.5])).toBe('steady');
    expect(trendOf([0, 0, 1.5, 1.5])).toBe('rising');
  });

  it('reads too few values as steady', () => {
    expect(trendOf([])).toBe('steady');
    expect(trendOf([42])).toBe('steady');
  });
});
