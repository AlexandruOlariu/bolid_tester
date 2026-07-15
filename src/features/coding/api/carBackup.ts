/** Pure shape + diff helpers for the "clone my car" full-coding backup (roadmap 6b.8): a dated JSON
 *  snapshot of every profile-declared module's long coding + adaptation-channel values. No device
 *  I/O — the reads live in useCarBackup, the restore goes through the existing gated coding write.
 *  These functions assemble the snapshot, compare two of them, and summarise one, and are
 *  unit-tested. See docs/features/coding.md (backup). */

import { bytesToHexString, diffCoding } from '@/shared/obd-core';
import type { HistoryVehicle } from '@/shared/state/historyStore';

/** Long coding captured for a module. */
export interface CarBackupCoding {
  did: string;
  bytes: number[];
  /** Space-separated uppercase hex, e.g. '01 00 10 00' — derived, for readable export/display. */
  hex: string;
}

/** One adaptation channel captured for a module. */
export interface CarBackupAdaptation {
  did: string;
  name: string;
  unit?: string;
  /** Raw bytes read (null when the read failed / channel unreachable). */
  raw: number[] | null;
  /** Decoded display value (null when unread / undecodable). */
  value: number | null;
}

/** One module in a snapshot, keyed by its ATSH request header (the stable per-module identity). */
export interface CarBackupModule {
  reqHeader: string;
  /** VAG 2-digit address when the profile maps this header to a scan module. */
  address?: string;
  name: string;
  partNumber?: string;
  softwareVersion?: string;
  /** Long coding — present only for codeable modules (restore target). */
  coding: CarBackupCoding | null;
  adaptations: CarBackupAdaptation[];
}

/** A full-car snapshot. Serializable; persisted (capped) and exportable as JSON. */
export interface CarBackup {
  id: string;
  ts: number;
  vehicle: HistoryVehicle;
  /** Protocol display label at snapshot time. */
  protocol: string;
  modules: CarBackupModule[];
}

/** Raw per-module reads the hook gathers, before id/ts/hex normalization. */
export interface CarBackupModuleInput {
  reqHeader: string;
  address?: string;
  name: string;
  partNumber?: string;
  softwareVersion?: string;
  coding?: { did: string; bytes: number[] } | null;
  adaptations?: CarBackupAdaptation[];
}

export interface BuildCarBackupInput {
  vehicle: HistoryVehicle;
  protocol: string;
  modules: CarBackupModuleInput[];
  ts?: number;
  id?: string;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize gathered reads into a serializable CarBackup (fills id/ts, derives coding hex). Pure. */
export function buildCarBackup(input: BuildCarBackupInput): CarBackup {
  return {
    id: input.id ?? newId(),
    ts: input.ts ?? Date.now(),
    vehicle: input.vehicle,
    protocol: input.protocol,
    modules: input.modules.map((m) => ({
      reqHeader: m.reqHeader,
      address: m.address,
      name: m.name,
      partNumber: m.partNumber,
      softwareVersion: m.softwareVersion,
      coding: m.coding ? { did: m.coding.did, bytes: m.coding.bytes.slice(), hex: bytesToHexString(m.coding.bytes) } : null,
      adaptations: (m.adaptations ?? []).map((a) => ({ ...a, raw: a.raw ? a.raw.slice() : null })),
    })),
  };
}

export interface BackupAdaptationDelta {
  did: string;
  name: string;
  before: number | null;
  after: number | null;
}

export interface BackupModuleDiff {
  reqHeader: string;
  name: string;
  /** Set when the module's long coding differs between the two snapshots. */
  codingChanged?: { before: string; after: string; changedBytes: number[] };
  /** Adaptation channels whose decoded value differs. */
  adaptationDeltas: BackupAdaptationDelta[];
}

/** Compare one module across two snapshots (`from` older/baseline, `to` newer/current). Pure — used
 *  to preview what a restore would change, and for a "what drifted since backup" view. */
export function diffBackupModule(from: CarBackupModule, to: CarBackupModule): BackupModuleDiff {
  let codingChanged: BackupModuleDiff['codingChanged'];
  if (from.coding && to.coding && from.coding.hex !== to.coding.hex) {
    codingChanged = {
      before: from.coding.hex,
      after: to.coding.hex,
      changedBytes: diffCoding(from.coding.bytes, to.coding.bytes).map((d) => d.index),
    };
  }
  const deltas: BackupAdaptationDelta[] = [];
  const dids = new Set([...from.adaptations.map((a) => a.did), ...to.adaptations.map((a) => a.did)]);
  for (const did of dids) {
    const a = from.adaptations.find((x) => x.did === did);
    const b = to.adaptations.find((x) => x.did === did);
    if ((a?.value ?? null) !== (b?.value ?? null)) {
      deltas.push({ did, name: b?.name ?? a?.name ?? did, before: a?.value ?? null, after: b?.value ?? null });
    }
  }
  return { reqHeader: to.reqHeader, name: to.name, codingChanged, adaptationDeltas: deltas };
}

export interface CarBackupSummary {
  modules: number;
  /** Modules that captured long coding (restore targets). */
  codedModules: number;
  /** Total adaptation channels captured. */
  adaptations: number;
}

/** Headline counts for a snapshot. Pure. */
export function summarizeCarBackup(b: CarBackup): CarBackupSummary {
  return {
    modules: b.modules.length,
    codedModules: b.modules.filter((m) => m.coding).length,
    adaptations: b.modules.reduce((n, m) => n + m.adaptations.length, 0),
  };
}
