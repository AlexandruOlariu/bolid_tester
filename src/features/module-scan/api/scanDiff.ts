/** Pure before/after diff of two saved auto-scans — the "did the repair work?" / used-car-baseline
 *  view. Per module (union of both scans by VAG address): faults appeared / cleared, coding changed,
 *  part number changed, and modules added / removed. No I/O; unit-tested. `a` is the OLDER scan
 *  (before), `b` the NEWER (after). See docs/features/module-scan.md. */

import type { SavedScan, SavedScanModule, SavedScanDtc } from '../model/scanHistoryStore';

export type ModuleDiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface FieldChange {
  before?: string;
  after?: string;
}

export interface ModuleDiff {
  address: string;
  name: string;
  status: ModuleDiffStatus;
  /** Faults present in the newer scan but not the older one. */
  faultsAppeared: SavedScanDtc[];
  /** Faults present in the older scan but not the newer one (fixed / cleared). */
  faultsCleared: SavedScanDtc[];
  /** Set when the long coding differs between scans. */
  codingChanged?: FieldChange;
  /** Set when the module part number differs between scans (module replaced / reflashed). */
  partNumberChanged?: FieldChange;
}

export interface ScanDiff {
  /** Older scan timestamp. */
  fromTs: number;
  /** Newer scan timestamp. */
  toTs: number;
  /** One entry per module across both scans, newer order first then removed modules. */
  modules: ModuleDiff[];
  /** Totals for a headline summary. */
  totals: {
    appeared: number;
    cleared: number;
    modulesAdded: number;
    modulesRemoved: number;
    modulesChanged: number;
  };
}

/** DTC identity within a module: SAE code + failure-type suffix (its display form). */
const dtcKey = (d: SavedScanDtc): string => d.display;

function faultDelta(from: SavedScanDtc[], to: SavedScanDtc[]): { appeared: SavedScanDtc[]; cleared: SavedScanDtc[] } {
  const fromKeys = new Set(from.map(dtcKey));
  const toKeys = new Set(to.map(dtcKey));
  return {
    appeared: to.filter((d) => !fromKeys.has(dtcKey(d))),
    cleared: from.filter((d) => !toKeys.has(dtcKey(d))),
  };
}

function diffModule(before: SavedScanModule | undefined, after: SavedScanModule | undefined): ModuleDiff {
  // Added: only in the newer scan.
  if (!before && after) {
    return {
      address: after.address,
      name: after.name,
      status: 'added',
      faultsAppeared: after.dtcs.slice(),
      faultsCleared: [],
    };
  }
  // Removed: only in the older scan.
  if (before && !after) {
    return {
      address: before.address,
      name: before.name,
      status: 'removed',
      faultsAppeared: [],
      faultsCleared: before.dtcs.slice(),
    };
  }
  const a = before as SavedScanModule;
  const b = after as SavedScanModule;
  const { appeared, cleared } = faultDelta(a.dtcs, b.dtcs);
  const codingChanged =
    (a.coding ?? undefined) !== (b.coding ?? undefined)
      ? { before: a.coding, after: b.coding }
      : undefined;
  const partNumberChanged =
    (a.partNumber ?? undefined) !== (b.partNumber ?? undefined)
      ? { before: a.partNumber, after: b.partNumber }
      : undefined;
  const changed = appeared.length > 0 || cleared.length > 0 || !!codingChanged || !!partNumberChanged;
  return {
    address: b.address,
    name: b.name,
    status: changed ? 'changed' : 'unchanged',
    faultsAppeared: appeared,
    faultsCleared: cleared,
    codingChanged,
    partNumberChanged,
  };
}

export function diffScans(a: SavedScan, b: SavedScan): ScanDiff {
  const byAddr = (list: SavedScanModule[]) => new Map(list.map((m) => [m.address, m]));
  const aMap = byAddr(a.modules);
  const bMap = byAddr(b.modules);

  const modules: ModuleDiff[] = [];
  // Newer scan order first (added + changed + unchanged), then modules only in the older scan.
  for (const m of b.modules) modules.push(diffModule(aMap.get(m.address), m));
  for (const m of a.modules) if (!bMap.has(m.address)) modules.push(diffModule(m, undefined));

  const totals = {
    appeared: modules.reduce((n, m) => n + m.faultsAppeared.length, 0),
    cleared: modules.reduce((n, m) => n + m.faultsCleared.length, 0),
    modulesAdded: modules.filter((m) => m.status === 'added').length,
    modulesRemoved: modules.filter((m) => m.status === 'removed').length,
    modulesChanged: modules.filter((m) => m.status === 'changed').length,
  };

  return { fromTs: a.ts, toTs: b.ts, modules, totals };
}
