/** Two-pane Live dashboard geometry (plan 21). Pure — no React Native import — so it is unit-tested
 *  under the `core` Jest project. Every width is in dp and is measured from the two-pane row itself
 *  (`onLayout`), so the side rail and the screen padding are already taken out. */

/** Narrowest a `ValueCard` gets (its `minWidth`). */
export const CARD_MIN_WIDTH = 150;
/** Gap between value cards (Tamagui space `$2`). */
export const CARD_GAP = 7;
/** Gap between the gauge column and the value-card column (Tamagui space `$4`). */
export const COLUMN_GAP = 18;
/** Widest the gauge column gets. */
export const LEFT_COLUMN_MAX_WIDTH = 360;
/** Share of the row the gauge column may take, so the card column keeps room for the cards. */
export const LEFT_COLUMN_SHARE = 0.45;

/** The gauge column's width in a two-pane row `rowWidth` dp wide: 45 % of the row, at most 360 dp. */
export function leftColumnWidth(rowWidth: number): number {
  return Math.min(LEFT_COLUMN_MAX_WIDTH, Math.round(Math.max(0, rowWidth) * LEFT_COLUMN_SHARE));
}

/** The value-card column's width: the whole row when the gauge column is left out (every gauge
 *  hidden and no fuel-economy card), otherwise what the gauge column and the gap leave. */
export function rightColumnWidth(rowWidth: number, hasLeft: boolean): number {
  const w = Math.max(0, rowWidth);
  return hasLeft ? Math.max(0, w - leftColumnWidth(w) - COLUMN_GAP) : w;
}

/** How many value cards fit side by side in a column `columnWidth` dp wide, at least
 *  `CARD_MIN_WIDTH` each, capped at `maxColumns` (2 on medium, 3 on expanded). Never below 1. */
export function cardColumns(columnWidth: number, maxColumns: number): number {
  const fit = Math.floor((Math.max(0, columnWidth) + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP));
  return Math.max(1, Math.min(Math.max(1, maxColumns), fit));
}

/** Each value card's width so `cardColumns` of them and their gaps fill the column exactly (a short
 *  last row keeps the grid's width rather than stretching). Floored, so rounding never wraps a row. */
export function cardWidth(columnWidth: number, maxColumns: number): number {
  const cols = cardColumns(columnWidth, maxColumns);
  return Math.max(0, Math.floor((Math.max(0, columnWidth) - CARD_GAP * (cols - 1)) / cols));
}
