/** The maintenance feature's contribution to the AI diagnostic agent (plan 34b): the
 *  `read_maintenance` tool (the **active car's** logbook — `maintenanceKeysFor` / `bucketFor`, as
 *  `useMaintenance` reads it — run through `computeDue`: per service item its status, last service
 *  and what is left in km / days), the `maintenance` procedure that runs it, and the `maintenance`
 *  capability skill. No adapter time. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/maintenance-log.md. */

import { clampDigest, computeDue, parseSkillFileOrThrow } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  DueInfo,
  ServiceItem,
  SkillFinding,
  SkillProcedure,
  ToolContext,
  ToolResult,
} from '@/shared/obd-core';
import { getActiveProfile } from '@/shared/state/activeProfile';
import { useGarageStore } from '@/shared/state/garageStore';
import { translate } from '@/shared/i18n';
import { bucketFor, maintenanceKeysFor, useMaintenanceStore } from '../model/maintenanceStore';
import maintenanceSkill from './maintenance.skill.json';

const NO_MAINTENANCE = 'No maintenance recorded for this car.';

/** Worst first, as the Maintenance screen lists them. */
const ORDER: Record<DueInfo['status'], number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 };

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A local `yyyy-mm-dd`, the date the user logged the service on. */
function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `"every 15000 km / 12 months"`. */
function intervalText(item: ServiceItem | undefined): string {
  const parts: string[] = [];
  if (item?.intervalKm) parts.push(`${item.intervalKm} km`);
  if (item?.intervalMonths) parts.push(`${item.intervalMonths} months`);
  return parts.length ? ` (every ${parts.join(' / ')})` : '';
}

/** `"1000 km left"` / `"5000 km overdue"`. */
const leftText = (n: number, unit: string): string =>
  n >= 0 ? `${n} ${unit} left` : `${-n} ${unit} overdue`;

/** `"<name> (every …): <status>, last <yyyy-mm-dd> at <km> km; <km> left, <days> left"`. */
function itemLine(due: DueInfo, item: ServiceItem | undefined): string {
  const head = `${due.name}${intervalText(item)}: ${due.status}`;
  if (due.lastDate == null) return `${head}, never logged`;
  const left: string[] = [];
  if (due.dueInKm != null) left.push(leftText(due.dueInKm, 'km'));
  if (due.dueInDays != null) left.push(leftText(due.dueInDays, 'days'));
  const tail = left.length ? `; ${left.join(', ')}` : '';
  return `${head}, last ${localDate(due.lastDate)} at ${due.lastOdoKm} km${tail}`;
}

/** The item's name in the app language, for the user-facing finding text. */
const itemName = (due: DueInfo): string =>
  translate(`maintenance:item.${due.itemId}`, { defaultValue: due.name });

async function readMaintenance(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const keys = maintenanceKeysFor(getActiveProfile().id, useGarageStore.getState().vehicles);
  const { items, byVehicle } = useMaintenanceStore.getState();
  const { entries, odoKm } = bucketFor(byVehicle, keys);
  if (entries.length === 0) return { digest: NO_MAINTENANCE, summary: 'Maintenance: none' };

  const due = computeDue(items, entries, { odoKm, now: ctx.now() }).sort(
    (a, b) => ORDER[a.status] - ORDER[b.status],
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = [
    odoKm == null
      ? 'Odometer: not entered, so the km left are unknown'
      : `Odometer: ${odoKm} km (as entered in the logbook)`,
    ...due.map((d) => itemLine(d, byId.get(d.itemId))),
  ];

  const findings: SkillFinding[] = [];
  for (const d of due) {
    if (d.status === 'overdue')
      findings.push({
        key: 'maintenance:agent.finding.overdue',
        severity: 'warn',
        values: { item: itemName(d) },
      });
    else if (d.status === 'soon')
      findings.push({
        key: 'maintenance:agent.finding.soon',
        severity: 'info',
        values: { item: itemName(d) },
      });
  }
  const overdue = due.filter((d) => d.status === 'overdue').length;
  const soon = due.filter((d) => d.status === 'soon').length;
  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: `Maintenance: ${overdue} overdue, ${soon} soon`,
    ...(findings.length ? { findings } : {}),
  };
}

const readMaintenanceTool: AgentTool = {
  name: 'read_maintenance',
  description:
    "This car's service logbook: per item (oil, filters, timing belt, brake fluid, coolant, DPF) " +
    'its status ok / soon / overdue / unknown, the last service date and km, and the km / days left.',
  labelKey: 'maintenance:agent.tool.read_maintenance',
  args: { type: 'object', properties: {} },
  costMs: 0,
  available: () => true,
  run: readMaintenance,
};

const maintenanceProcedure: SkillProcedure = {
  id: 'maintenance',
  costMs: readMaintenanceTool.costMs,
  run: (ctx) => ctx.callTool('read_maintenance', {}),
};

export const agentTools: AgentContribution = {
  tools: [readMaintenanceTool],
  procedures: [maintenanceProcedure],
  skills: [parseSkillFileOrThrow(maintenanceSkill, 'maintenance')],
};
