/** Badge-site helpers for the verification badge (plan 25): mark registry profile items confirmed for
 *  one test, then undo. The registry objects are shared module state inside a jest file, so every
 *  test that calls `confirmItems` restores them in a `finally` (or `afterEach`). */
import type { Confirmation } from '@/shared/obd-core';

/** A well-formed confirmation (the evidence rule is enforced by vehicle-docs-sync, not here). */
export const TEST_CONFIRMED: Confirmation = { on: '2026-11-20', source: 'sniffer-capture' };

/** The badge text `TEST_CONFIRMED` renders. */
export const CONFIRMED_TEXT = 'Confirmed 2026-11-20 (sniffer capture)';
export const ILLUSTRATIVE_TEXT = 'Illustrative — not yet confirmed on this car';

/** Set `confirmed` on each item in place; the returned function restores what was there. */
export function confirmItems(items: { confirmed?: Confirmation }[]): () => void {
  const saved = items.map((item) => ({
    item,
    had: Object.prototype.hasOwnProperty.call(item, 'confirmed'),
    value: item.confirmed,
  }));
  for (const item of items) item.confirmed = TEST_CONFIRMED;
  return () => {
    for (const { item, had, value } of saved) {
      if (had) item.confirmed = value;
      else delete item.confirmed;
    }
  };
}
