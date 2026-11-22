import { useCallback } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { useDpfStore } from '../model/dpfStore';
import { dpfAvailable, dpfPids, readDpf } from '../api/dpfRead';

/** Read the active profile's diesel/DPF Mode 22 PIDs (diesel, CAN only) and interpret them via
 *  assessDpf — the read itself is `readDpf`, shared with the AI agent's `read_dpf` tool. */
export function useDpf() {
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const values = useDpfStore((s) => s.values);
  const report = useDpfStore((s) => s.report);
  const running = useDpfStore((s) => s.running);
  const set = useDpfStore((s) => s.set);

  const dieselPids = dpfPids(profile);
  const available = dpfAvailable(profile, session?.currentProtocol ?? 'UNKNOWN');

  const refresh = useCallback(async () => {
    if (!session || !dpfAvailable(profile, session.currentProtocol)) return;
    set({ running: true });
    try {
      const out = await readDpf(session, profile);
      set(out ? { values: out.values, report: out.report, running: false } : { running: false });
    } catch (e) {
      logError({ source: 'dpf', error: e, severity: 'warning' });
      set({ running: false });
    }
  }, [session, profile, set]);

  return { available, values, report, running, refresh, dieselPids };
}
