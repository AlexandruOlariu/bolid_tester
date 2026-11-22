/** Pure planner for restoring adaptation channels from a full-car backup (plan 24). Given one
 *  snapshot module, the live profile's channels and a fresh read of the car, it decides per channel
 *  whether a restore would write anything and, if not, why. No device I/O: the reads and the gated
 *  writes live in useAdaptationRestore, which sends every `restore` item through the adaptations
 *  feature's `writeChannel` (backup → write → verify, bounds re-checked there). See
 *  docs/features/coding.md (backup → adaptation restore). */

import { adaptationBoundsError, decodeAdaptationRaw } from '@/shared/obd-core';
import type { AdaptationChannel } from '@/shared/vehicles';
import { buildCarBackup, type BackupModuleDiff, type CarBackupModule } from './carBackup';
import { translate } from '@/shared/i18n';

/** Why a snapshot channel is not restored. */
export type RestoreSkip = 'equal' | 'no-channel' | 'no-snapshot-raw' | 'out-of-bounds' | 'locked';

export const RESTORE_SKIPS: readonly RestoreSkip[] = [
  'equal',
  'no-channel',
  'no-snapshot-raw',
  'out-of-bounds',
  'locked',
];

/** One adaptation channel of a snapshot module, compared with the car. */
export interface RestorePlanItem {
  did: string;
  name: string;
  unit?: string;
  /** The live profile's channel for this (reqHeader, did); null when the profile no longer has it. */
  channel: AdaptationChannel | null;
  snapshotRaw: number[] | null;
  snapshotValue: number | null;
  /** Raw bytes the fresh read returned (null when the read failed or was not made). */
  currentRaw: number[] | null;
  currentValue: number | null;
  action: 'restore' | 'skip';
  skip?: RestoreSkip;
  /** Plain-English reason for a skip (the bounds message for `out-of-bounds`). */
  reason?: string;
}

export interface PlanRestoreOptions {
  /** Whether a security-locked channel can be unlocked (a seed/key is available for it). Without a
   *  security plugin every `ch.security` channel is locked. */
  unlockable: (ch: AdaptationChannel) => boolean;
}

/** Default when no security-access plugin is loaded: channels demanding SecurityAccess stay locked. */
export const noSecurityUnlock: PlanRestoreOptions['unlockable'] = (ch) => !ch.security;

const sameBytes = (a: number[], b: number[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Plan a restore of one snapshot module's adaptation channels. Rules, in order: no matching
 *  (reqHeader, did) channel → `no-channel`; snapshot raw missing → `no-snapshot-raw`; snapshot raw
 *  fails the shared bounds guard → `out-of-bounds` (refused, never clamped — a later profile revision
 *  may have tightened the bounds); `ch.security` and not unlockable → `locked`; current raw equals
 *  the snapshot raw byte for byte → `equal`; otherwise `restore`. Pure. */
export function planAdaptationRestore(
  snapshot: CarBackupModule,
  liveChannels: AdaptationChannel[],
  current: Record<string, number[] | undefined>,
  opts: PlanRestoreOptions = { unlockable: noSecurityUnlock },
): RestorePlanItem[] {
  return snapshot.adaptations.map((a): RestorePlanItem => {
    const channel =
      liveChannels.find(
        (c) => c.reqHeader === snapshot.reqHeader && c.did.toUpperCase() === a.did.toUpperCase(),
      ) ?? null;
    const currentRaw = current[a.did] ?? null;
    const base = {
      did: a.did,
      name: channel?.name ?? a.name,
      unit: channel?.unit ?? a.unit,
      channel,
      snapshotRaw: a.raw ? a.raw.slice() : null,
      snapshotValue: a.raw && channel ? decodeAdaptationRaw(a.raw, channel) : a.value,
      currentRaw: currentRaw ? currentRaw.slice() : null,
      currentValue: currentRaw && channel ? decodeAdaptationRaw(currentRaw, channel) : null,
    };
    const skip = (s: RestoreSkip, reason: string): RestorePlanItem => ({
      ...base,
      action: 'skip',
      skip: s,
      reason,
    });

    if (!channel) {
      return skip('no-channel', translate('coding:restore.skipNoChannel'));
    }
    if (!a.raw) {
      return skip('no-snapshot-raw', translate('coding:restore.skipNoRaw'));
    }
    const bounds = adaptationBoundsError(channel, a.raw);
    if (bounds) return skip('out-of-bounds', bounds);
    if (channel.security && !opts.unlockable(channel)) {
      return skip('locked', translate('coding:restore.skipLocked'));
    }
    if (currentRaw && sameBytes(currentRaw, a.raw)) {
      return skip('equal', translate('coding:restore.skipEqual'));
    }
    return { ...base, action: 'restore' };
  });
}

export interface RestorePlanSummary {
  restore: number;
  skipped: Record<RestoreSkip, number>;
}

/** Counts for a plan: how many channels a "Restore all" would write, and skips by reason. Pure. */
export function summarizeRestorePlan(items: RestorePlanItem[]): RestorePlanSummary {
  const skipped = Object.fromEntries(RESTORE_SKIPS.map((s) => [s, 0])) as Record<
    RestoreSkip,
    number
  >;
  let restore = 0;
  for (const it of items) {
    if (it.action === 'restore') restore++;
    else if (it.skip) skipped[it.skip]++;
  }
  return { restore, skipped };
}

/** The car as it is now, shaped like the snapshot module (same identity, fresh coding + channel
 *  reads), so `diffBackupModule(snapshot, current)` reports what drifted since the backup. `current`
 *  is keyed by DID and may also hold the module's coding DID. Pure. */
export function currentModuleFromReads(
  snapshot: CarBackupModule,
  liveChannels: AdaptationChannel[],
  current: Record<string, number[] | undefined>,
): CarBackupModule {
  const codingBytes = snapshot.coding ? current[snapshot.coding.did] : undefined;
  const [mod] = buildCarBackup({
    vehicle: { id: '', label: '', vin: null },
    protocol: '',
    id: 'current',
    ts: 0,
    modules: [
      {
        reqHeader: snapshot.reqHeader,
        address: snapshot.address,
        name: snapshot.name,
        partNumber: snapshot.partNumber,
        softwareVersion: snapshot.softwareVersion,
        coding:
          snapshot.coding && codingBytes ? { did: snapshot.coding.did, bytes: codingBytes } : null,
        adaptations: snapshot.adaptations.map((a) => {
          const ch = liveChannels.find(
            (c) =>
              c.reqHeader === snapshot.reqHeader && c.did.toUpperCase() === a.did.toUpperCase(),
          );
          const raw = current[a.did] ?? null;
          return {
            did: a.did,
            name: a.name,
            unit: a.unit,
            raw,
            value: raw ? decodeAdaptationRaw(raw, ch ?? { byteCount: raw.length }) : null,
          };
        }),
      },
    ],
  }).modules;
  return mod;
}

/** One-line header for a compared module, e.g. "2 adaptations differ, coding unchanged". The
 *  adaptation part is counted from the plan `items` on raw bytes — the same comparison the rows use
 *  — so it never disagrees with them: a channel "differs" only when both the snapshot and the fresh
 *  read have bytes and they are not identical; a channel the profile no longer declares, the backup
 *  could not read, or the car did not answer for is "not compared". The coding part comes from
 *  `diffBackupModule(snapshot, current)`. Pure. */
export function restoreHeadline(
  snapshot: CarBackupModule,
  current: CarBackupModule,
  diff: BackupModuleDiff,
  items: RestorePlanItem[],
): string {
  let differs = 0;
  let notCompared = 0;
  for (const it of items) {
    if (!it.channel || !it.snapshotRaw || !it.currentRaw) notCompared++;
    else if (!sameBytes(it.snapshotRaw, it.currentRaw)) differs++;
  }
  const parts: string[] = [];
  if (snapshot.adaptations.length) {
    if (differs === 0 && notCompared === 0) parts.push(translate('coding:restore.allMatch'));
    else {
      parts.push(
        differs === 0
          ? translate('coding:restore.noneDiffer')
          : translate('coding:restore.differ', { count: differs }),
      );
      if (notCompared) parts.push(translate('coding:restore.notCompared', { count: notCompared }));
    }
  }
  if (snapshot.coding) {
    if (!current.coding) parts.push(translate('coding:restore.codingNotRead'));
    else
      parts.push(
        diff.codingChanged
          ? translate('coding:restore.codingChanged')
          : translate('coding:restore.codingUnchanged'),
      );
  }
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
