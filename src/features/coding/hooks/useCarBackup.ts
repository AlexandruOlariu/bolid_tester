import { useCallback, useState } from 'react';
import { readModuleIdent, decodeAdaptationRaw, isCan, PROTOCOL_LABELS } from '@/shared/obd-core';
import type { AdaptationChannel, CodingModule } from '@/shared/vehicles';
import { vehicleLabel, type VehicleProfile } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { logError } from '@/shared/state/errorLogStore';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
// Reuse the adaptations feature's read path (the restore writes live in useAdaptationRestore).
import { readChannel } from '@/features/adaptations/api/adaptationService';
import {
  buildCarBackup,
  type CarBackup,
  type CarBackupModuleInput,
  type CarBackupAdaptation,
} from '../api/carBackup';
import { useCarBackupStore } from '../model/carBackupStore';
import { useBackupWorkStore } from '../model/backupWorkStore';

interface ModuleSpec {
  reqHeader: string;
  rxFilter: string;
  address?: string;
  name: string;
  coding?: CodingModule;
  channels: AdaptationChannel[];
}

/** Union (by ATSH request header) of the profile's codeable modules and its adaptation-channel
 *  modules — every module the snapshot should read. Coding modules first, then adaptation-only. */
function moduleSpecs(profile: VehicleProfile): ModuleSpec[] {
  const specs = new Map<string, ModuleSpec>();
  const addressOf = (header: string) =>
    profile.modules?.find((m) => m.reqHeader === header)?.address;

  for (const m of profile.codingModules ?? []) {
    specs.set(m.reqHeader, {
      reqHeader: m.reqHeader,
      rxFilter: m.rxFilter,
      address: addressOf(m.reqHeader),
      name: m.module,
      coding: m,
      channels: [],
    });
  }
  for (const ch of profile.adaptations ?? []) {
    const existing = specs.get(ch.reqHeader);
    if (existing) existing.channels.push(ch);
    else
      specs.set(ch.reqHeader, {
        reqHeader: ch.reqHeader,
        rxFilter: ch.rxFilter,
        address: addressOf(ch.reqHeader),
        name: ch.module,
        channels: [ch],
      });
  }
  return [...specs.values()];
}

/** Full coding backup ("clone my car"): read every profile-declared module's coding + adaptation
 *  channel values into a dated snapshot; export as JSON. Restore is per-module through the existing
 *  gated coding write and adaptation channels through useAdaptationRestore (see CodingBackup UI). */
export function useCarBackup() {
  const session = useSessionStore((s) => s.session);
  const profile = useActiveProfile();
  const save = useCarBackupStore((s) => s.save);
  const [creating, setCreating] = useState(false);

  const specs = moduleSpecs(profile);
  const available = specs.length > 0 && isCan(session?.currentProtocol ?? 'UNKNOWN') && !!session;

  const create = useCallback(async (): Promise<CarBackup | null> => {
    if (!session) return null;
    // Shared Backup-section gate: never read modules while a restore / compare drives the bus.
    const gate = useBackupWorkStore.getState();
    if (!gate.tryBegin()) return null;
    setCreating(true);
    try {
      const modules: CarBackupModuleInput[] = [];
      for (const spec of specs) {
        let partNumber: string | undefined;
        let softwareVersion: string | undefined;
        let coding: { did: string; bytes: number[] } | null = null;
        // Ident + coding read share the same physical addressing.
        try {
          await session.setHeader(spec.reqHeader);
          await session.setRxFilter(spec.rxFilter);
          const ident = await readModuleIdent((cmd) => session.send(cmd));
          partNumber = ident.partNumber ?? spec.coding?.partNumber;
          softwareVersion = ident.softwareVersion;
          if (spec.coding) {
            const bytes = await session.readExtended(spec.coding.codingDid);
            if (bytes) coding = { did: spec.coding.codingDid, bytes };
          }
        } catch (e) {
          logError({
            source: 'coding/backup',
            error: e,
            severity: 'warning',
            context: { module: spec.name },
          });
        } finally {
          await session.resetAddressing();
        }
        // Adaptation channels via the reused read path (each self-addresses + restores).
        const adaptations: CarBackupAdaptation[] = [];
        for (const ch of spec.channels) {
          const raw = await readChannel(session, ch);
          adaptations.push({
            did: ch.did,
            name: ch.name,
            unit: ch.unit,
            raw: raw ?? null,
            value: raw ? decodeAdaptationRaw(raw, ch) : null,
          });
        }
        modules.push({
          reqHeader: spec.reqHeader,
          address: spec.address,
          name: spec.name,
          partNumber,
          softwareVersion,
          coding,
          adaptations,
        });
      }

      const info = useSessionStore.getState().info;
      const proto = session.currentProtocol;
      const snapshot = buildCarBackup({
        vehicle: { id: profile.id, label: vehicleLabel(profile), vin: info?.vin ?? null },
        protocol: PROTOCOL_LABELS[proto] ?? proto,
        modules,
      });
      save(snapshot);
      return snapshot;
    } catch (e) {
      logError({ source: 'coding/backup', error: e });
      return null;
    } finally {
      setCreating(false);
      gate.end();
    }
  }, [session, specs, profile, save]);

  /** Write a snapshot to a JSON file and open the OS share sheet (dependency-tolerant). */
  const exportBackup = useCallback(async (backup: CarBackup): Promise<string | null> => {
    try {
      const FileSystem = await import('expo-file-system' as string);
      const Sharing = await import('expo-sharing' as string);
      const dir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? '';
      if (!dir) return null;
      const stamp = new Date(backup.ts).toISOString().replace(/[:.]/g, '-');
      const uri = `${dir}car-backup-${stamp}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(backup, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/json',
          dialogTitle: 'Export car backup',
        });
      }
      return uri;
    } catch (e) {
      logError({ source: 'coding/backup/export', error: e });
      return null;
    }
  }, []);

  return { available, creating, create, exportBackup };
}
