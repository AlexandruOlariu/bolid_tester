/**
 * Generic SAE J2012 / ISO 15031-6 powertrain codes, P0000–P0FFF — the whole P0 family, composed
 * from the per-range part files (each ≤ 1 800 lines, see the plan-05 sourcing rules there):
 *
 * - `p0-part1.ts` P0000–P02FF fuel & air metering, injector circuits, turbo/supercharger
 * - `p0-part2.ts` P0300–P05FF ignition / misfire, auxiliary emission controls, speed & idle
 * - `p0-part3.ts` P0600–P09FF computer & output circuits, transmission
 * - `p0-part4.ts` P0A00–P0AFF hybrid / electric propulsion (P0B00–P0CFF have no entries yet and
 *   fall back to the range text)
 *
 * The parts cover disjoint ranges; `dtcDatabase.test.ts` enforces that no key appears twice.
 *
 * License: MIT, authored for bolid-tester (see LICENSE at the repository root).
 */
import { P0_PART1 } from './p0-part1';
import { P0_PART2 } from './p0-part2';
import { P0_PART3 } from './p0-part3';
import { P0_PART4 } from './p0-part4';

/** The parts, in range order — exported so the test can check them for overlap. */
export const P0_PARTS: readonly Record<string, string>[] = [P0_PART1, P0_PART2, P0_PART3, P0_PART4];

export const P0: Record<string, string> = Object.assign({}, ...P0_PARTS);
