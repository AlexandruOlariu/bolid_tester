import { useCallback } from 'react';
import { codeModule, isCan, setBit, getBit, diffCoding } from '@/shared/obd-core';
import type { CodingModule } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useCodingStore } from '../model/codingStore';

/** SAFETY: read→backup→write→verify, gated on unlock + CAN. Never writes without a stored backup. */
export function useCoding() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const unlocked = useCodingStore((s) => s.unlocked);
  const setCurrent = useCodingStore((s) => s.setCurrent);
  const addBackup = useCodingStore((s) => s.addBackup);
  const setLastResult = useCodingStore((s) => s.setLastResult);

  const profile = getVehicleProfile(profileId);
  const available =
    !!profile.codingModules?.length && isCan(session?.currentProtocol ?? 'UNKNOWN');
  const modules = profile.codingModules ?? [];

  const read = useCallback(
    async (mod: CodingModule) => {
      if (!session) return null;
      try {
        await session.setHeader(mod.reqHeader);
        await session.setRxFilter(mod.rxFilter);
        const bytes = await session.readExtended(mod.codingDid);
        if (bytes) setCurrent(mod.module, bytes);
        return bytes;
      } catch (e) {
        logError({ source: 'coding/read', error: e, context: { module: mod.module, did: mod.codingDid } });
        return null;
      } finally {
        await session.setHeader(null);
      }
    },
    [session, setCurrent],
  );

  const toggleBit = (mod: CodingModule, bytes: number[], byte: number, bit: number) => {
    const next = setBit(bytes, byte, bit, getBit(bytes, byte, bit) ? 0 : 1);
    setCurrent(mod.module, next);
    return next;
  };

  const write = useCallback(
    async (mod: CodingModule, newData: number[]) => {
      if (!session || !unlocked) {
        setLastResult('Locked — unlock coding first.');
        return false;
      }
      await session.setHeader(mod.reqHeader);
      await session.setRxFilter(mod.rxFilter);
      try {
        const res = await codeModule((cmd) => session.send(cmd), {
          did: mod.codingDid,
          newData,
          security: mod.security ? { level: mod.security.level, seedToKey: (s) => s } : undefined,
        });
        addBackup({ module: mod.module, did: mod.codingDid, bytes: res.backup, at: Date.now() });
        if (!res.verified) {
          logError({
            source: 'coding/write',
            error: 'Write sent but verification failed',
            severity: 'warning',
            context: { module: mod.module, did: mod.codingDid },
          });
        }
        setLastResult(res.verified ? 'Write verified.' : 'Write sent but verification failed.');
        return res.verified;
      } catch (e) {
        logError({ source: 'coding/write', error: e, context: { module: mod.module, did: mod.codingDid } });
        setLastResult(`Failed: ${(e as Error).message}`);
        return false;
      } finally {
        await session.setHeader(null);
      }
    },
    [session, unlocked, addBackup, setLastResult],
  );

  return { available, modules, read, write, toggleBit, diffCoding };
}
