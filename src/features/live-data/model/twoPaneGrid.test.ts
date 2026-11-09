import {
  CARD_GAP,
  CARD_MIN_WIDTH,
  cardColumns,
  cardWidth,
  leftColumnWidth,
  rightColumnWidth,
} from './twoPaneGrid';

describe('two-pane Live grid (plan 21)', () => {
  it('the gauge column is 45 % of the row, at most 360 dp', () => {
    expect(leftColumnWidth(592)).toBe(266); // 640 dp landscape phone, minus 2 × 24 padding
    expect(leftColumnWidth(672)).toBe(302); // 800 dp window with an ~80 dp rail
    expect(leftColumnWidth(1100)).toBe(360);
    expect(leftColumnWidth(-5)).toBe(0);
  });

  it('the card column takes the whole row when the gauge column is left out', () => {
    expect(rightColumnWidth(592, true)).toBe(592 - 266 - 18);
    expect(rightColumnWidth(592, false)).toBe(592);
  });

  it('fits as many >= 150 dp cards as the column holds, capped per layout class', () => {
    expect(cardColumns(286, 2)).toBe(1); // too narrow for two 150 dp cards and a gap
    expect(cardColumns(2 * CARD_MIN_WIDTH + CARD_GAP, 2)).toBe(2);
    expect(cardColumns(456, 3)).toBe(2); // 31 % would be < 150 dp: two per row, not a gap
    expect(cardColumns(800, 3)).toBe(3);
    expect(cardColumns(800, 2)).toBe(2);
    expect(cardColumns(0, 3)).toBe(1);
  });

  it('card widths fill the column exactly and never drop under the minimum when two or more fit', () => {
    for (const [w, max] of [
      [286, 2],
      [310, 2],
      [354, 2],
      [456, 3],
      [722, 3],
    ] as const) {
      const cols = cardColumns(w, max);
      const cw = cardWidth(w, max);
      expect(cw * cols + CARD_GAP * (cols - 1)).toBeLessThanOrEqual(w);
      expect(w - (cw * cols + CARD_GAP * (cols - 1))).toBeLessThan(cols);
      expect(cw).toBeGreaterThanOrEqual(cols > 1 ? CARD_MIN_WIDTH : 0);
    }
    expect(cardWidth(286, 2)).toBe(286); // a lone card fills the row, as on a phone
  });
});
