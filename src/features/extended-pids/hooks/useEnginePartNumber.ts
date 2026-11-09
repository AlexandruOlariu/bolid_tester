import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useActiveProfile } from '@/shared/state/activeProfile';
import { resolveEnginePartNumber } from '../model/measuringGroups';

/** The connected engine ECU's part number (F187), read ONCE per session by the connection service
 *  and cached in `sessionStore.info.partNumber`; in the simulator it falls back to the profile's
 *  engine `sampleIdent.F187`. Null when disconnected or unknown (then no label pack, no groups). */
export function useEnginePartNumber(): string | null {
  const info = useSessionStore((s) => s.info);
  const simulated = useSettingsStore((s) => s.adapterSource) === 'mock';
  const profile = useActiveProfile();
  if (!info) return null;
  return resolveEnginePartNumber(info.partNumber, profile, simulated);
}
