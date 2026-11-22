/**
 * Generic SAE J2012 / ISO 15031-6 powertrain codes, P2000–P2FFF — the whole P2 family, composed
 * from the per-range part files (see the plan-05 sourcing rules there):
 *
 * - `p2-part1.ts` P2000–P24FF aftertreatment, runners, throttle actuator, EGT, NOx/O2, fuel
 *   pressure, ignition coils, knock, EVAP, secondary air
 * - `p2-part2.ts` P2500–P2FFF charging / power input, A/C, boost control, coolant pump, intake
 *   heaters, transmission (P27xx–P28xx), O2 range/performance (P2A0x)
 *
 * The parts cover disjoint ranges; `dtcDatabase.test.ts` enforces that no key appears twice.
 *
 * License: MIT, authored for bolid-tester (see LICENSE at the repository root).
 */
import { P2_PART1 } from './p2-part1';
import { P2_PART2 } from './p2-part2';

/** The parts, in range order — exported so the test can check them for overlap. */
export const P2_PARTS: readonly Record<string, string>[] = [P2_PART1, P2_PART2];

export const P2: Record<string, string> = Object.assign({}, ...P2_PARTS);
