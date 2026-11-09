import { useCallback } from 'react';
import { isCan } from '@/shared/obd-core';
import type { AdaptationChannel } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
// Adaptation writes go through the adaptations feature's own guarded service and unlock — the same
// backup → write → verify path and bounds guard the Adaptations screen uses, never a second one.
import {
  readChannel,
  writeChannel,
  type WriteOutcome,
} from '@/features/adaptations/api/adaptationService';
import { useAdaptationsStore } from '@/features/adaptations/model/adaptationsStore';
import type { CarBackupModule } from '../api/carBackup';
import { BACKUP_BUSY_MESSAGE, useBackupWorkStore } from '../model/backupWorkStore';
import {
  noSecurityUnlock,
  planAdaptationRestore,
  type RestorePlanItem,
} from '../api/adaptationRestore';

export interface RestoreAllResult {
  done: number;
  failed?: { did: string; message: string };
}

const hex = (raw: number[]) => raw.map((b) => b.toString(16).padStart(2, '0')).join('');

/** Restore adaptation channels from a full-car backup (plan 24): read the car fresh, plan per
 *  channel (pure `planAdaptationRestore`), then write the `restore` items one by one through the
 *  gated `writeChannel`. Gated on the **adaptations** unlock (these are adaptation writes), checked
 *  again at write time so a lock flipped mid-flow fails closed. Needs a CAN session (`available`),
 *  like the Adaptations screen. `busy` is the Backup section's shared work gate
 *  (`backupWorkStore`), so a compare / restore never overlaps another panel's, a coding restore or
 *  a backup being created — the session has no lock of its own. */
export function useAdaptationRestore() {
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const unlocked = useAdaptationsStore((s) => s.unlocked);
  const busy = useBackupWorkStore((s) => s.busy);
  const available = !!session && isCan(session.currentProtocol);

  const channelsFor = useCallback(
    (module: CarBackupModule): AdaptationChannel[] =>
      (profile.adaptations ?? []).filter((c) => c.reqHeader === module.reqHeader),
    [profile],
  );

  /** Fresh live read of every profile channel in the module (reusing `readChannel`, which
   *  self-addresses and resets), plus the module's long coding when the snapshot has one (keyed by
   *  its coding DID). Returns DID -> raw; a failed read is simply absent. Returns null without
   *  touching the bus when there is no CAN session or another backup action holds the gate. */
  const readCurrent = useCallback(
    async (module: CarBackupModule): Promise<Record<string, number[] | undefined> | null> => {
      if (!session || !isCan(session.currentProtocol)) return null;
      const gate = useBackupWorkStore.getState();
      if (!gate.tryBegin()) return null;
      const out: Record<string, number[] | undefined> = {};
      try {
        for (const ch of channelsFor(module)) {
          try {
            const raw = await readChannel(session, ch);
            if (raw) out[ch.did] = raw;
          } catch (e) {
            logError({
              source: 'coding/adaptation-restore/read',
              error: e,
              severity: 'warning',
              context: { did: ch.did },
            });
          }
        }
        const codingMod = profile.codingModules?.find((m) => m.reqHeader === module.reqHeader);
        if (module.coding && codingMod) {
          try {
            await session.setHeader(codingMod.reqHeader);
            await session.setRxFilter(codingMod.rxFilter);
            const bytes = await session.readExtended(module.coding.did);
            if (bytes) out[module.coding.did] = bytes;
          } catch (e) {
            logError({
              source: 'coding/adaptation-restore/read',
              error: e,
              severity: 'warning',
              context: { module: module.name },
            });
          } finally {
            await session.resetAddressing();
          }
        }
        return out;
      } finally {
        gate.end();
      }
    },
    [session, profile, channelsFor],
  );

  const plan = useCallback(
    (module: CarBackupModule, current: Record<string, number[] | undefined>) =>
      // No security-access plugin ships, so channels demanding SecurityAccess stay locked.
      planAdaptationRestore(module, channelsFor(module), current, { unlockable: noSecurityUnlock }),
    [channelsFor],
  );

  /** One write without touching `busy` (shared by restoreOne / restoreAll). */
  const writeItem = useCallback(
    async (item: RestorePlanItem): Promise<WriteOutcome> => {
      if (!session || !isCan(session.currentProtocol)) {
        return { ok: false, message: 'Not connected over CAN.' };
      }
      // Read the unlock at write time, not from the render: fail closed if it was turned off.
      if (!useAdaptationsStore.getState().unlocked) {
        return {
          ok: false,
          message: 'Locked — unlock adaptations on the Adaptations screen first.',
        };
      }
      if (item.action !== 'restore' || !item.channel || !item.snapshotRaw) {
        return { ok: false, message: item.reason ?? 'Nothing to restore for this channel.' };
      }
      const ch = item.channel;
      const raw = item.snapshotRaw;
      const store = useAdaptationsStore.getState();
      let res: WriteOutcome;
      try {
        res = await writeChannel(session, ch, raw);
      } catch (e) {
        // writeChannel reports its own failures; this only catches a dead link in its finally.
        res = { ok: false, message: `Failed: ${(e as Error).message}` };
      }
      if (res.backup) {
        store.addBackup({ did: ch.did, module: ch.module, raw: res.backup, at: Date.now() });
      }
      if (res.ok) store.setValue(ch.did, raw);
      else
        logError({
          source: 'coding/adaptation-restore/write',
          error: res.message,
          severity: 'warning',
          context: { did: ch.did, newRaw: hex(raw) },
        });
      store.setLastResult(res.ok ? `Restored ${ch.name} from the backup.` : res.message);
      return res;
    },
    [session],
  );

  /** Writes one plan item through `writeChannel` (bounds re-checked there, current value backed up
   *  into the adaptations store first). Requires the adaptations unlock. */
  const restoreOne = useCallback(
    async (item: RestorePlanItem): Promise<WriteOutcome> => {
      const gate = useBackupWorkStore.getState();
      if (!gate.tryBegin()) return { ok: false, message: BACKUP_BUSY_MESSAGE };
      try {
        return await writeItem(item);
      } finally {
        gate.end();
      }
    },
    [writeItem],
  );

  /** Sequential restore of every `action === 'restore'` item; stops at the first failure. */
  const restoreAll = useCallback(
    async (
      items: RestorePlanItem[],
      onProgress?: (done: number, total: number) => void,
    ): Promise<RestoreAllResult> => {
      const todo = items.filter((i) => i.action === 'restore');
      let done = 0;
      const gate = useBackupWorkStore.getState();
      if (!gate.tryBegin()) {
        return todo.length
          ? { done, failed: { did: todo[0].did, message: BACKUP_BUSY_MESSAGE } }
          : { done };
      }
      try {
        for (const item of todo) {
          const res = await writeItem(item);
          if (!res.ok) return { done, failed: { did: item.did, message: res.message } };
          done++;
          onProgress?.(done, todo.length);
        }
        return { done };
      } finally {
        gate.end();
      }
    },
    [writeItem],
  );

  return { busy, unlocked, available, readCurrent, plan, restoreOne, restoreAll };
}
