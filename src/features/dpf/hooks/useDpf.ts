import { useCallback } from 'react';
import { assessDpf, isCan, DpfInput } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useDpfStore, DpfValue } from '../model/dpfStore';

/** Read the active profile's diesel/DPF Mode 22 PIDs (CAN only) and interpret them via assessDpf. */
export function useDpf() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const values = useDpfStore((s) => s.values);
  const report = useDpfStore((s) => s.report);
  const running = useDpfStore((s) => s.running);
  const set = useDpfStore((s) => s.set);

  const profile = getVehicleProfile(profileId);
  const dieselPids = (profile.extendedPids ?? []).filter(
    (p) => p.category === 'dpf' || p.category === 'diesel',
  );
  const proto = session?.currentProtocol ?? 'UNKNOWN';
  const available = dieselPids.length > 0 && isCan(proto);

  const refresh = useCallback(async () => {
    if (!session || dieselPids.length === 0 || !isCan(session.currentProtocol)) return;
    set({ running: true });
    try {
      const out: DpfValue[] = [];
      const input: DpfInput = {};
      for (const p of dieselPids) {
        const bytes = await session.readExtended(p.did);
        const value = bytes ? p.decode(bytes) : null;
        out.push({ did: p.did, name: p.name, unit: p.unit, value, role: p.role });
        if (p.role && value != null) {
          if (p.role === 'sootPct') input.sootPct = value;
          else if (p.role === 'sootMassG') input.sootMassG = value;
          else if (p.role === 'ashMassG') input.ashMassG = value;
          else if (p.role === 'kmSinceRegen') input.kmSinceRegen = value;
          else if (p.role === 'regenCount') input.regenCount = value;
          else if (p.role === 'egtC') input.egtC = value;
        }
      }
      set({ values: out, report: assessDpf(input), running: false });
    } catch (e) {
      logError({ source: 'dpf', error: e, severity: 'warning' });
      set({ running: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profileId, set]);

  return { available, values, report, running, refresh };
}
