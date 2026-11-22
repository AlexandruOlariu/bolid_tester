/** The module-scan feature's contribution to the AI diagnostic agent (plan 34b): the `scan_modules`
 *  tool (every UDS module's ident and fault codes, read through the read-only facade's
 *  `withModule`; part of triage), the `module_scan` procedure and the `module_scan` capability
 *  skill. The agent never addresses airbag (15) or immobilizer (25), and never opens a TP2.0
 *  channel: TP2.0 modules come only from this car's latest saved scan, labelled with its date.
 *  Composed by the app layer (`src/app/ai-diagnose.tsx`). See docs/features/module-scan.md. */

import {
  AGENT_EXCLUDED_MODULE_ADDRESSES,
  Elm327ClosedError,
  ModuleNotAllowedError,
  clampDigest,
  isCan,
  isModuleUnreachableError,
  parseSkillFileOrThrow,
  readModuleDtcs,
  readModuleIdent,
  vagModuleName,
} from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  SkillFinding,
  SkillProcedure,
  ToolContext,
  ToolResult,
  UdsDtc,
} from '@/shared/obd-core';
import { verificationState } from '@/shared/vehicles';
import type { DiagModule, VehicleProfile } from '@/shared/vehicles';
import {
  useScanHistoryStore,
  type SavedScan,
  type SavedScanTp20Module,
} from '../model/scanHistoryStore';
import moduleScanSkill from './module_scan.skill.json';

/** Most modules one call may name. */
const MAX_ADDRESSES = 12;
/** Adapter time one module's ident + DTC read may take. */
const MODULE_COST_MS = 3000;
/** A tool declares one cost, so it is the longest call (capped like the plan's 30 s). */
const SCAN_MODULES_COST_MS = 30_000;

const SKIPPED = "skipped (outside the agent's scope)";

const isExcluded = (address: string): boolean =>
  (AGENT_EXCLUDED_MODULE_ADDRESSES as readonly string[]).includes(address.toUpperCase());

const isUdsModule = (m: DiagModule): boolean => m.transport === 'uds' && !!m.reqHeader;

/** The profile's UDS modules the agent may address (never airbag / immobilizer). */
function scannableModules(profile: VehicleProfile): DiagModule[] {
  return (profile.modules ?? []).filter((m) => isUdsModule(m) && !isExcluded(m.address));
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();

/** A local `yyyy-mm-dd`, the day the user saw the scan on. */
function isoDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One scanned module, as the digest line and (when it holds codes) the finding report it. */
interface ModuleOutcome {
  line: string;
  answered: boolean;
  silent: boolean;
  skipped: boolean;
  dtcs: UdsDtc[];
  module: DiagModule;
}

const unconfirmedTag = (m: DiagModule): string =>
  verificationState(m) === 'unverified' ? ' (unconfirmed)' : '';

function dtcList(dtcs: UdsDtc[]): string {
  return dtcs.map((d) => `${d.sae} status 0x${hex2(d.status)}`).join(', ');
}

async function scanOne(ctx: ToolContext, module: DiagModule): Promise<ModuleOutcome> {
  const head = `${module.address} ${module.name}`;
  const base = { module, answered: false, silent: false, skipped: false, dtcs: [] };
  try {
    const { ident, dtcs } = await ctx.session.withModule(
      { address: module.address, reqHeader: module.reqHeader as string, rxFilter: module.rxFilter },
      async (send) => ({
        ident: await readModuleIdent(send),
        dtcs: await readModuleDtcs(send, 0xff),
      }),
    );
    const idParts = [
      ident.partNumber && `part ${ident.partNumber}`,
      ident.softwareVersion && `sw ${ident.softwareVersion}`,
    ].filter((p): p is string => typeof p === 'string' && p.length > 0);
    const id = idParts.length ? idParts.join(' ') : 'no ident';
    const codes = dtcs.length ? `${dtcs.length} DTCs: ${dtcList(dtcs)}` : '0 DTCs';
    return {
      ...base,
      answered: true,
      dtcs,
      line: `${head}: ${id}; ${codes}${unconfirmedTag(module)}`,
    };
  } catch (e) {
    // A closed link ends the run (the loop reports it as disconnected), not one module's read.
    if (e instanceof Elm327ClosedError) throw e;
    if (e instanceof ModuleNotAllowedError)
      return { ...base, skipped: true, line: `${head}: ${SKIPPED}` };
    const msg = e instanceof Error ? e.message : String(e);
    if (isModuleUnreachableError(msg))
      return { ...base, silent: true, line: `${head}: no answer${unconfirmedTag(module)}` };
    return { ...base, line: `${head}: read failed: ${msg}${unconfirmedTag(module)}` };
  }
}

/** The newest saved scan of the active car (`ctx.profile`) that holds TP2.0 modules. */
function latestTp20Scan(profileId: string): SavedScan | null {
  const scans = useScanHistoryStore
    .getState()
    .scans.filter((s) => s.vehicle.id === profileId && (s.tp20?.modules.length ?? 0) > 0);
  if (scans.length === 0) return null;
  return scans.reduce((a, b) => (b.ts > a.ts ? b : a));
}

function tp20Row(m: SavedScanTp20Module): string {
  const dtcs = m.dtcs ?? [];
  const codes = dtcs.length
    ? `${dtcs.length} DTCs (${dtcs.map((d) => `${d.vag} status 0x${hex2(d.status)}`).join(', ')})`
    : m.dtcs
      ? '0 DTCs'
      : 'faults not read';
  return `${hex2(m.address)} ${m.name}: ${m.state}, ${codes}`;
}

/** The TP2.0 line: rows of the latest saved scan (never airbag / immobilizer, only `targets` when
 *  given), or a pointer to the Module scan screen; null when the car has no TP2.0 module to report. */
function tp20Line(profile: VehicleProfile, targets: string[] | null): string | null {
  const wanted = (address: string) =>
    !isExcluded(address) && (targets === null || targets.includes(address));
  const saved = latestTp20Scan(profile.id);
  const rows = (saved?.tp20?.modules ?? []).filter(
    (m) => m.state !== 'not-installed' && wanted(hex2(m.address)),
  );
  if (saved && rows.length > 0)
    return `TP2.0 modules (saved scan ${isoDay(saved.ts)}): ${rows.map(tp20Row).join('; ')}`;
  const declared = (profile.modules ?? []).some(
    (m) => m.transport === 'tp20' && wanted(m.address.toUpperCase()),
  );
  return declared ? 'TP2.0 modules: not read by the agent; open Module scan to read them.' : null;
}

/** The name to show for an address outside the profile's UDS list. */
function nameFor(profile: VehicleProfile, address: string): string {
  return (
    profile.modules?.find((m) => m.address.toUpperCase() === address)?.name ??
    vagModuleName(parseInt(address, 16))
  );
}

async function scanModules(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { profile } = ctx;
  const targets = Array.isArray(args.addresses)
    ? [...new Set(args.addresses.map((a) => String(a).toUpperCase()))]
    : null;
  const udsModules = (profile.modules ?? []).filter(isUdsModule);
  const chosen = udsModules.filter(
    (m) => targets === null || targets.includes(m.address.toUpperCase()),
  );

  const outcomes: ModuleOutcome[] = [];
  for (const m of chosen) {
    // Never even ask the facade for an excluded module: it would refuse, but there is no reason to.
    outcomes.push(
      isExcluded(m.address)
        ? {
            module: m,
            answered: false,
            silent: false,
            skipped: true,
            dtcs: [],
            line: `${m.address} ${m.name}: ${SKIPPED}`,
          }
        : await scanOne(ctx, m),
    );
  }

  const extra: string[] = [];
  let extraSkipped = 0;
  for (const address of targets ?? []) {
    if (chosen.some((m) => m.address.toUpperCase() === address)) continue;
    if (isExcluded(address)) {
      extraSkipped++;
      extra.push(`${address} ${nameFor(profile, address)}: ${SKIPPED}`);
    } else if (!profile.modules?.some((m) => m.address.toUpperCase() === address)) {
      extra.push(`${address}: not in this car's module list`);
    }
  }

  const scanned = outcomes.filter((o) => !o.skipped);
  const answered = scanned.filter((o) => o.answered).length;
  const silent = scanned.filter((o) => o.silent).length;
  const skipped = outcomes.length - scanned.length + extraSkipped;
  const withCodes = outcomes.filter((o) => o.dtcs.length > 0);
  const dtcTotal = withCodes.reduce((n, o) => n + o.dtcs.length, 0);

  const tp20 = tp20Line(profile, targets);
  const lines = [
    `UDS modules: ${scanned.length} scanned, ${answered} answered, ${silent} silent, ${skipped} skipped; ` +
      `${dtcTotal} DTCs in ${withCodes.length} modules.`,
    ...(tp20 ? [tp20] : []),
    ...outcomes.map((o) => o.line),
    ...extra,
  ];

  const findings: SkillFinding[] = withCodes.map((o) => ({
    key: 'moduleScan:agent.finding.moduleDtcs',
    severity: 'warn',
    values: { module: `${o.module.address} ${o.module.name}`, count: o.dtcs.length },
    codes: o.dtcs.map((d) => d.sae),
    unconfirmed: verificationState(o.module) === 'unverified',
  }));
  const answeredModules = scanned.filter((o) => o.answered).map((o) => o.module);

  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: `Module scan: ${scanned.length} modules, ${answered} answered, ${dtcTotal} DTCs`,
    ...(findings.length ? { findings } : {}),
    ...(answeredModules.length > 0 &&
    answeredModules.every((m) => verificationState(m) === 'unverified')
      ? { unconfirmed: true }
      : {}),
  };
}

const scanModulesTool: AgentTool = {
  name: 'scan_modules',
  description:
    "Read every UDS control module's part number, software version and fault codes (with status " +
    'bytes), or only the given VAG addresses. Airbag (15) and immobilizer (25) are never read; ' +
    'TP2.0 modules come from the last saved Module scan.',
  labelKey: 'moduleScan:agent.tool.scan_modules',
  args: {
    type: 'object',
    properties: {
      addresses: {
        type: 'array',
        items: { type: 'string', pattern: '^[0-9A-F]{2}$' },
        maxItems: MAX_ADDRESSES,
        description: 'VAG module addresses, e.g. ["01","03"]. Absent: every module.',
      },
    },
  },
  costMs: Math.min(SCAN_MODULES_COST_MS, MODULE_COST_MS * MAX_ADDRESSES),
  triage: { args: {} },
  available: (ctx) => isCan(ctx.protocol) && scannableModules(ctx.profile).length > 0,
  run: scanModules,
};

const moduleScanProcedure: SkillProcedure = {
  id: 'module_scan',
  costMs: scanModulesTool.costMs,
  run: (ctx) => ctx.callTool('scan_modules', {}),
};

export const agentTools: AgentContribution = {
  tools: [scanModulesTool],
  procedures: [moduleScanProcedure],
  skills: [parseSkillFileOrThrow(moduleScanSkill, 'module_scan')],
};
