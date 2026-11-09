/** Resolve a label pack's measuring groups against the active profile's extended DIDs, for the
 *  Groups section of the Extended PIDs screen. Pure — unit-tested. See
 *  docs/features/extended-pids.md → "Measuring groups". */

import { measurementLabel, measuringGroups, type LabelPack } from '@/shared/labels';
import type { DiagModule, ExtendedPid, VehicleProfile } from '@/shared/vehicles';

export interface GroupEntry {
  did: string;
  /** The profile's definition (decoder + unit), or null when the profile does not declare the DID —
   *  the UI then shows "no definition for <DID> in this profile" and never polls it. */
  def: ExtendedPid | null;
  /** Display name: the pack's measurement label, else the profile's DID name, else `DID <did>`. */
  label: string;
  unit: string;
}

export interface ResolvedGroup {
  /** Group number as VCDS shows it, e.g. '075'. */
  no: string;
  name: string;
  description?: string;
  entries: GroupEntry[];
  /** The entries the profile can actually read (polled, logged, charted). */
  defs: ExtendedPid[];
}

export function resolveMeasuringGroups(
  pack: LabelPack | null,
  extendedPids: readonly ExtendedPid[],
): ResolvedGroup[] {
  return measuringGroups(pack).map(([no, g]) => {
    const entries = g.dids.map((did): GroupEntry => {
      const def = extendedPids.find((p) => p.did.toUpperCase() === did) ?? null;
      const label = measurementLabel(pack, did);
      return {
        did,
        def,
        label: label?.name ?? def?.name ?? `DID ${did}`,
        unit: def?.unit ?? label?.unit ?? '',
      };
    });
    return {
      no,
      name: g.name,
      description: g.description,
      entries,
      defs: entries.flatMap((e) => (e.def ? [e.def] : [])),
    };
  });
}

/** The engine module a profile lists for the module scan (VAG address '01', or the standard OBD
 *  engine request header 7E0). */
export function engineModuleOf(profile: VehicleProfile): DiagModule | undefined {
  return (profile.modules ?? []).find(
    (m) => m.transport === 'uds' && (m.address === '01' || m.reqHeader === '7E0'),
  );
}

/** The part number that picks the label pack: the one read from the car at connect
 *  (`SessionInfo.partNumber`), else — in the simulator only — the profile's engine module
 *  `sampleIdent.F187`, else none. */
export function resolveEnginePartNumber(
  readPartNumber: string | null | undefined,
  profile: VehicleProfile,
  simulated: boolean,
): string | null {
  if (readPartNumber) return readPartNumber;
  if (!simulated) return null;
  return engineModuleOf(profile)?.sampleIdent?.F187 ?? null;
}
