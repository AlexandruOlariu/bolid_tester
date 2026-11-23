/** What the AI diagnostic agent is told about the car (plan 34a): the vehicle context built from the
 *  selected profile and the per-car known checks for the read codes. Store-free, so the app's agent
 *  service and the offline eval set (src/shared/ai/eval) send the model the same context. See
 *  docs/features/ai-diagnose.md. */

import type { KnownCheck, VehicleContext } from '../obd-core/analysis/aiDiagnosis';
import { vagCodeForDtc } from '../obd-core/obd/dtc';
import { GENERIC_GUIDE, matchFaultGuide } from './faultGuides';
import { vehicleLabel } from './index';
import type { VehicleProfile } from './types';

/** Map the selected vehicle profile into the AI's default vehicle context. Always returns something
 *  (even for the generic profile) so the model knows what kind of car it is looking at. */
export function toVehicleContext(p: VehicleProfile): VehicleContext {
  return {
    label: vehicleLabel(p),
    year: p.year || undefined,
    engine: p.engine && p.engine !== '—' ? p.engine : undefined,
    fuel: p.fuel && p.fuel !== 'other' ? p.fuel : undefined,
    expectedProtocol:
      p.expectedProtocol && p.expectedProtocol !== 'AUTO' ? p.expectedProtocol : undefined,
    notes: p.notes || undefined,
    make: p.make,
  };
}

/** The curated guides (not the generic fallback) that match the read codes on this car, one entry
 *  per distinct guide, listed to the model as "Known checks for this car". */
export function knownChecksFor(profileId: string, codes: string[]): KnownCheck[] {
  const out: KnownCheck[] = [];
  const seen = new Set<object>();
  for (const code of codes) {
    const guide = matchFaultGuide(profileId, code, vagCodeForDtc(code) || undefined);
    if (guide === GENERIC_GUIDE || seen.has(guide)) continue;
    seen.add(guide);
    out.push({ code, note: guide.note });
  }
  return out;
}
