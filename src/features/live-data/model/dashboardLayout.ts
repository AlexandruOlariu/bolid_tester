/** Pure dashboard-layout math: ordering + visibility over a per-profile override. Kept free of React,
 *  zustand, and native deps (persistStorage pulls in expo-file-system) so it is unit-tested directly,
 *  the same split as EngineHost/pollPids. The persisted store lives in dashboardLayoutStore.ts. */

export type DashboardItemKind = 'gauge' | 'card';

/** A candidate dashboard item (a gauge or a value card for one PID). */
export interface DashboardItem {
  id: string; // stable id, `${kind}:${pid}`
  pid: string;
  kind: DashboardItemKind;
}

/** The persisted override for one profile. `order` lists item ids the user has explicitly arranged
 *  (others append after, in candidate order); `hidden` is the set of item ids to not render. */
export interface ProfileLayout {
  order: string[];
  hidden: string[];
}

export const EMPTY_LAYOUT: ProfileLayout = { order: [], hidden: [] };

/** Stable id for an item. */
export function itemId(kind: DashboardItemKind, pid: string): string {
  return `${kind}:${pid}`;
}

/** Order candidates by the layout: ids present in `layout.order` first (in that order), then any
 *  remaining candidates in their original (default) order. Unknown ids in `order` are ignored. */
export function orderItems(candidates: DashboardItem[], layout: ProfileLayout | undefined): DashboardItem[] {
  if (!layout || layout.order.length === 0) return candidates.slice();
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: DashboardItem[] = [];
  const placed = new Set<string>();
  for (const id of layout.order) {
    const c = byId.get(id);
    if (c && !placed.has(id)) {
      out.push(c);
      placed.add(id);
    }
  }
  for (const c of candidates) if (!placed.has(c.id)) out.push(c);
  return out;
}

/** True when an item is hidden by the layout. */
export function isHidden(id: string, layout: ProfileLayout | undefined): boolean {
  return !!layout && layout.hidden.includes(id);
}

/** Ordered candidates minus the hidden ones — what the dashboard actually renders. */
export function visibleItems(candidates: DashboardItem[], layout: ProfileLayout | undefined): DashboardItem[] {
  return orderItems(candidates, layout).filter((c) => !isHidden(c.id, layout));
}

/** Move `id` one step up (`-1`) or down (`+1`) within the given full ordered id list, returning a new
 *  explicit order. A no-op at the ends or when the id is absent. */
export function moveInOrder(orderedIds: string[], id: string, dir: -1 | 1): string[] {
  const i = orderedIds.indexOf(id);
  if (i < 0) return orderedIds.slice();
  const j = i + dir;
  if (j < 0 || j >= orderedIds.length) return orderedIds.slice();
  const next = orderedIds.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Toggle an id's presence in a set (array). */
export function toggleInSet(set: string[], id: string): string[] {
  return set.includes(id) ? set.filter((x) => x !== id) : [...set, id];
}
