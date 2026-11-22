/** The DPF read (plan 34b): the active profile's DPF / diesel Mode 22 DIDs read one by one, decoded
 *  with the profile decoders, their `role`s mapped into a `DpfInput` and assessed by `assessDpf`.
 *  A plain function so the DPF screen (`useDpf`) and the AI agent's `read_dpf` tool share it; it
 *  needs only `readExtended` and the protocol, which both a `DiagnosticSession` and the agent's
 *  read-only facade have. See docs/features/dpf.md. */

import { assessDpf, isCan } from '@/shared/obd-core';
import type { DpfInput, DpfReport, ProtocolId, ReadOnlySession } from '@/shared/obd-core';
import type { ExtendedPid, VehicleProfile } from '@/shared/vehicles';
import type { DpfValue } from '../model/dpfStore';

/** The profile's DIDs the DPF monitor reads: category `dpf` or `diesel`, in profile order. */
export function dpfPids(profile: VehicleProfile): ExtendedPid[] {
  return (profile.extendedPids ?? []).filter(
    (p) => p.category === 'dpf' || p.category === 'diesel',
  );
}

/** The DPF monitor applies to a diesel car with DPF / diesel DIDs on a CAN link (Mode 22). */
export function dpfAvailable(profile: VehicleProfile, protocol: ProtocolId): boolean {
  return profile.fuel === 'diesel' && dpfPids(profile).length > 0 && isCan(protocol);
}

/** `assessDpf` inputs, keyed by the `ExtendedPid.role` that feeds them. */
const INPUT_ROLES = [
  'sootPct',
  'sootMassG',
  'ashMassG',
  'kmSinceRegen',
  'regenCount',
  'egtC',
] as const satisfies readonly (keyof DpfInput & NonNullable<ExtendedPid['role']>)[];

/** True when `role` feeds `assessDpf` (soot, ash, distance and count since regen, EGT). */
export function isDpfInputRole(role: string | undefined): role is (typeof INPUT_ROLES)[number] {
  return (INPUT_ROLES as readonly string[]).includes(role ?? '');
}

/** Read and assess the DPF DIDs, or null when the car is not a diesel on CAN with DPF DIDs. A DID
 *  with no (usable) answer reads as `value: null` and is left out of the assessment; a link error
 *  throws. */
export async function readDpf(
  session: Pick<ReadOnlySession, 'readExtended' | 'currentProtocol'>,
  profile: VehicleProfile,
): Promise<{ values: DpfValue[]; report: DpfReport } | null> {
  if (!dpfAvailable(profile, session.currentProtocol)) return null;
  const values: DpfValue[] = [];
  const input: DpfInput = {};
  for (const p of dpfPids(profile)) {
    const bytes = await session.readExtended(p.did);
    const decoded = bytes && bytes.length > 0 ? p.decode(bytes) : null;
    // A short or empty answer decodes to NaN: that is no reading, not a value.
    const value = decoded != null && Number.isFinite(decoded) ? decoded : null;
    values.push({ did: p.did, name: p.name, unit: p.unit, value, role: p.role });
    if (value != null && isDpfInputRole(p.role)) input[p.role] = value;
  }
  return { values, report: assessDpf(input) };
}
