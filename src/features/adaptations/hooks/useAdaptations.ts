import { useCallback } from 'react';
import { isCan, decodeAdaptationRaw, encodeAdaptationValue } from '@/shared/obd-core';
import { findLabelPack, adaptationLabel } from '@/shared/labels';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { getVehicleProfile } from '@/shared/vehicles';
import type { AdaptationChannel } from '@/shared/vehicles';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { readChannel, writeChannel } from '../api/adaptationService';
import { useAdaptationsStore } from '../model/adaptationsStore';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';

/** VCDS-style adaptation channels: browse, read, edit within bounds, write with backup+verify,
 *  restore. Unlock-gated like coding. */
export function useAdaptations() {
  const session = useSessionStore((s) => s.session);
  const profileId = useVehicleStore((s) => s.selectedProfileId);
  const store = useAdaptationsStore();
  // Best-effort label enrichment from the live-scanned part number (module-scan results), so the
  // same channel shows its label-pack description when the pack matches the real module.
  const scanResults = useModuleScanStore((s) => s.results);

  const profile = getVehicleProfile(profileId);
  const channels = profile.adaptations ?? [];
  const available = !!session && channels.length > 0 && isCan(session?.currentProtocol ?? 'UNKNOWN');

  const packFor = useCallback(
    (ch: AdaptationChannel) => {
      const scanned = scanResults.find((r) => r.module.reqHeader === ch.reqHeader);
      return findLabelPack(scanned?.ident?.partNumber);
    },
    [scanResults],
  );

  const describe = useCallback(
    (ch: AdaptationChannel) => adaptationLabel(packFor(ch), ch.did)?.description ?? null,
    [packFor],
  );

  const read = useCallback(
    async (ch: AdaptationChannel) => {
      if (!session) return null;
      store.setRunning(true);
      try {
        const raw = await readChannel(session, ch);
        if (raw) store.setValue(ch.did, raw);
        return raw;
      } catch (e) {
        logError({ source: 'adaptations/read', error: e, context: { did: ch.did } });
        return null;
      } finally {
        store.setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; session is the only reactive input
    [session],
  );

  const write = useCallback(
    async (ch: AdaptationChannel, displayValue: number) => {
      if (!session) return false;
      if (!store.unlocked) {
        store.setLastResult('Locked — enable the adaptations unlock first.');
        return false;
      }
      if (ch.min !== undefined && displayValue < ch.min) {
        store.setLastResult(`Out of bounds: minimum is ${ch.min}${ch.unit ?? ''}.`);
        return false;
      }
      if (ch.max !== undefined && displayValue > ch.max) {
        store.setLastResult(`Out of bounds: maximum is ${ch.max}${ch.unit ?? ''}.`);
        return false;
      }
      const newRaw = encodeAdaptationValue(displayValue, ch);
      store.setRunning(true);
      try {
        const res = await writeChannel(session, ch, newRaw);
        if (res.backup) {
          store.addBackup({ did: ch.did, module: ch.module, raw: res.backup, at: Date.now() });
        }
        if (res.ok) store.setValue(ch.did, newRaw);
        else
          logError({
            source: 'adaptations/write',
            error: res.message,
            severity: 'warning',
            context: { did: ch.did, newRaw: newRaw.map((b) => b.toString(16).padStart(2, '0')).join('') },
          });
        store.setLastResult(res.message);
        return res.ok;
      } finally {
        store.setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; reactive inputs (session, unlock) are listed
    [session, store.unlocked],
  );

  const restore = useCallback(
    async (ch: AdaptationChannel, raw: number[]) => {
      if (!session) return false;
      store.setRunning(true);
      try {
        const res = await writeChannel(session, ch, raw);
        if (res.ok) store.setValue(ch.did, raw);
        store.setLastResult(res.ok ? 'Restored.' : res.message);
        return res.ok;
      } finally {
        store.setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; session is the only reactive input
    [session],
  );

  const display = useCallback(
    (ch: AdaptationChannel, raw: number[] | undefined) =>
      raw ? decodeAdaptationRaw(raw, ch) : null,
    [],
  );

  return { available, channels, describe, read, write, restore, display };
}
