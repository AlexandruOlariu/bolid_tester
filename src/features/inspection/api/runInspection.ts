/** The used-car inspection's reads (plan 34b): readiness, stored / pending / permanent codes, the
 *  freeze frame, the distance since codes were cleared (Mode 01 PID 31), the in-use counters and the
 *  VIN, assessed by `assessInspection`. A plain function so the Inspection screen (`useInspection`)
 *  and the AI agent's `read_inspection` tool share it; it needs only standard-OBD2 reads, which both
 *  a `DiagnosticSession` and the agent's read-only facade have. See
 *  docs/features/used-car-inspection.md. */

import { assessInspection, decodeVin } from '@/shared/obd-core';
import type { InspectionInput, InspectionReport, ReadOnlySession } from '@/shared/obd-core';

/** The session reads the inspection uses. */
export type InspectionSession = Pick<
  ReadOnlySession,
  'readReadiness' | 'readDtcs' | 'readFreezeFrame' | 'readValue' | 'readIupr' | 'readVin'
>;

/** Run the snapshot and assess it. `knownVin` is the VIN already read at connect time; when it is
 *  null the VIN is read here. A link error throws. */
export async function runInspection(
  ro: InspectionSession,
  knownVin: string | null,
): Promise<InspectionReport> {
  const readiness = await ro.readReadiness();
  const stored = await ro.readDtcs('03');
  const pending = await ro.readDtcs('07');
  const permanent = await ro.readDtcs('0A');
  const freeze = await ro.readFreezeFrame();
  const dist = await ro.readValue('0131');
  const iupr = await ro.readIupr();
  const vin = knownVin ?? (await ro.readVin());

  const input: InspectionInput = {
    vinValid: vin ? decodeVin(vin).validFormat : false,
    readiness,
    stored,
    pending,
    permanent,
    freezeFramePresent: !!freeze && (freeze.triggerDtc != null || freeze.values.length > 0),
    distanceSinceClearKm: dist ? dist.value : null,
    iupr,
  };
  return assessInspection(input);
}
