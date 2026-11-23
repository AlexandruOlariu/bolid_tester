/** The on-device procedures of the symptom playbooks (plan 34c), one per playbook that has one; each
 *  procedure id equals its playbook name. They read through core tools (`read_live`, `read_dtcs`),
 *  the read-only session and the core `battery_capture` procedure, and reach a feature's tool or
 *  procedure only when it is offered for the car (`hasTool` / `hasSkill`, or the playbook's
 *  `requires.skills`). The pure analysis modules judge (`assessFuelTrims`, `assessBoost`,
 *  `assessCooling`, `assessMisfire`). A part that could not be measured is said in the digest and
 *  never judged: no finding comes from a missing value. Digests are model-facing English.
 *  See docs/features/ai-diagnose.md. */

import { assessBoost } from '../../analysis/boost';
import { assessCooling, warmupCurve, type WarmupCurve } from '../../analysis/cooling';
import { assessFuelTrims, type TrimReading } from '../../analysis/fuelTrims';
import { MISFIRE_MIDS, assessMisfire } from '../../analysis/misfire';
import type { TripSample } from '../../analysis/trip';
import { Elm327ClosedError } from '../../elm327/Elm327Client';
import type { Mode06Result } from '../../obd/mode06';
import { readLiveCostMs, type DtcSet, type LiveStats } from '../coreTools';
import { clampDigest, oneDecimal } from '../digest';
import { BATTERY_MAX_MS } from '../procedures/batteryCapture';
import type {
  DriverReply,
  ProcedureContext,
  SkillFinding,
  SkillProcedure,
  ToolResult,
} from '../types';

const FINDING = 'aiDiagnose:agent.finding.';

/** Rpm a stationary rev hold must reach to count, when the car has no boost range of its own. */
export const HOLD_MIN_RPM = 2200;
/** Charging under electrical load below this voltage (engine running) is weak. */
export const CHARGING_UNDER_LOAD_MIN_V = 13.2;
/** Above this rpm the engine counts as running (charging, fuel trims, boost). */
export const ENGINE_RUNNING_MIN_RPM = 600;
/** Below this coolant temperature the engine may still be in open loop: fuel trims mean nothing. */
export const TRIMS_WARM_MIN_C = 70;
/** Stored codes `check_engine_light` looks up one by one. */
export const CHECK_ENGINE_MAX_DETAILS = 4;
/** Recent app errors `keeps_disconnecting` lists. */
export const APP_ERRORS_LIMIT = 10;

const IDLE_TRIM_SECONDS = 5;
const HOLD_SECONDS = 5;
const IDLE_BOOST_SECONDS = 3;
const LOAD_SECONDS = 5;
const VOLTAGE_SAMPLE_MS = 500;

const STFT = '0106';
const LTFT = '0107';
const RPM = '010C';
const MAF = '0110';
const MAP = '010B';
const BARO = '0133';
const COOLANT = '0105';
const MODULE_V = '0142';

const round1 = (x: number): number => Math.round(x * 10) / 10;
const orDash = (x: number | null | undefined): number | string => (x == null ? '—' : x);

/** One `read_live` call: the per-PID statistics of the PIDs that answered. */
async function readLive(
  ctx: ProcedureContext,
  pids: string[],
  seconds: number,
): Promise<Record<string, LiveStats>> {
  const r = await ctx.callTool('read_live', { pids, seconds });
  return (r.data ?? {}) as Record<string, LiveStats>;
}

/** The digest line for a driver step that did not happen, or null when the driver did it. */
function driverMissed(step: string, reply: DriverReply): string | null {
  switch (reply.kind) {
    case 'done':
    case 'choice':
      return null;
    case 'cant':
      return `${step}: driver could not do it.`;
    case 'timeout':
      return `${step}: driver could not do it (no answer in time).`;
    case 'moving':
      return `${step}: driver could not do it (the car started moving).`;
    case 'refused':
      return `${step}: not asked (${reply.reason === 'moving' ? 'the car is moving' : 'speed unknown'}).`;
  }
}

const notAnswered = (data: Record<string, LiveStats>, pids: string[]): string[] =>
  pids.filter((p) => !data[p]);

// ---- fuel trims ----

const TRIM_PIDS = [STFT, LTFT, RPM, MAF];
const IDLE_TRIM_PIDS = [...TRIM_PIDS, COOLANT];

/** The digest line when the engine is not confirmed running at idle (010C silent or at or below
 *  {@link ENGINE_RUNNING_MIN_RPM}), or null when it runs. */
function engineNotRunning(data: Record<string, LiveStats>, what: string): string | null {
  const rpm = data[RPM]?.avg;
  if (rpm == null) return `010C not answered: engine running not confirmed; ${what} not judged.`;
  if (rpm <= ENGINE_RUNNING_MIN_RPM)
    return `engine not running (${Math.round(rpm)} rpm): ${what} not judged.`;
  return null;
}

function trimReading(data: Record<string, LiveStats>): TrimReading {
  const avg = (pid: string) => (data[pid] ? round1(data[pid].avg) : null);
  return { stftPct: avg(STFT), ltftPct: avg(LTFT), rpm: avg(RPM), mafGs: avg(MAF) };
}

async function fuelTrims(ctx: ProcedureContext): Promise<ToolResult> {
  const lines = ['Fuel trims (STFT 0106 + LTFT 0107, bank 1), idle then a 2500 rpm hold.'];
  const idleData = await readLive(ctx, IDLE_TRIM_PIDS, IDLE_TRIM_SECONDS);
  const idleMissing = notAnswered(idleData, [STFT, LTFT]);
  if (idleMissing.length) {
    lines.push(`${idleMissing.join(', ')} not answered: trims not judged.`);
    return { digest: lines.join('\n'), summary: 'Fuel trims: not judged (no data)' };
  }
  const notRunning = engineNotRunning(idleData, 'trims');
  if (notRunning) {
    lines.push(notRunning);
    return { digest: lines.join('\n'), summary: 'Fuel trims: not judged (engine not running)' };
  }
  const coolantC = idleData[COOLANT] ? round1(idleData[COOLANT].avg) : null;
  if (coolantC == null || coolantC < TRIMS_WARM_MIN_C) {
    lines.push(
      coolantC == null
        ? '0105 not answered: engine not confirmed warm (open loop possible); trims not judged.'
        : `engine cold (coolant ${coolantC} °C, under ${TRIMS_WARM_MIN_C} °C; open loop possible): trims not judged.`,
    );
    return { digest: lines.join('\n'), summary: 'Fuel trims: not judged (engine not warm)' };
  }

  let hold: TrimReading | null = null;
  const missed = driverMissed('rev hold', await ctx.askDriver('hold_2500_rpm'));
  if (missed) lines.push(`${missed} Idle part only.`);
  else {
    const holdData = await readLive(ctx, TRIM_PIDS, HOLD_SECONDS);
    const minRpm = ctx.profile.boost?.minHoldRpm ?? HOLD_MIN_RPM;
    const maxRpm = holdData[RPM]?.max ?? null;
    if (maxRpm == null) lines.push('010C not answered at the rev hold: hold part not judged.');
    else if (maxRpm < minRpm)
      lines.push(
        `rev hold not reached (max ${Math.round(maxRpm)} rpm); needs ${minRpm} rpm, hold part not judged.`,
      );
    else {
      const holdMissing = notAnswered(holdData, [STFT, LTFT]);
      if (holdMissing.length) lines.push(`${holdMissing.join(', ')} not answered at the rev hold.`);
      hold = trimReading(holdData);
    }
  }

  const result = assessFuelTrims(trimReading(idleData), hold);
  lines.push(...result.notes);
  const findings: SkillFinding[] =
    result.pattern === 'insufficient'
      ? []
      : [
          {
            key: `${FINDING}trims.${result.pattern}`,
            severity: result.severity,
            values: { idle: orDash(result.idleTotalPct), hold: orDash(result.holdTotalPct) },
          },
        ];
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `Fuel trims: ${result.pattern} (idle ${orDash(result.idleTotalPct)} %${
      result.holdTotalPct == null ? '' : `, hold ${result.holdTotalPct} %`
    })`,
    findings,
  };
}

// ---- boost ----

async function boost(ctx: ProcedureContext): Promise<ToolResult> {
  const range = ctx.profile.boost;
  if (!range)
    return {
      digest: 'No expected boost range for this car: boost not judged.',
      summary: 'Boost: not judged (no range)',
    };
  const lines = ['Boost (MAP 010B minus baro 0133), idle then a 2500 rpm hold.'];
  const idle = await readLive(ctx, [MAP, BARO, RPM], IDLE_BOOST_SECONDS);
  if (!idle[MAP]) {
    lines.push('010B not answered: boost not judged.');
    return { digest: lines.join('\n'), summary: 'Boost: not judged (no data)' };
  }
  const notRunning = engineNotRunning(idle, 'boost');
  if (notRunning) {
    lines.push(notRunning);
    return { digest: lines.join('\n'), summary: 'Boost: not judged (engine not running)' };
  }

  let holdMapKpa: number | null = null;
  let holdMaxRpm: number | null = null;
  const missed = driverMissed('rev hold', await ctx.askDriver('hold_2500_rpm'));
  if (missed) lines.push(`${missed} Idle part only.`);
  else {
    const hold = await readLive(ctx, [MAP, RPM], HOLD_SECONDS);
    holdMapKpa = hold[MAP] ? round1(hold[MAP].max) : null;
    holdMaxRpm = hold[RPM] ? Math.round(hold[RPM].max) : null;
    if (holdMapKpa == null) lines.push('010B not answered at the rev hold.');
    if (holdMaxRpm == null) lines.push('010C not answered at the rev hold.');
  }

  const result = assessBoost(
    {
      idleMapKpa: round1(idle[MAP].avg),
      idleRpm: idle[RPM] ? Math.round(idle[RPM].avg) : null,
      holdMapKpa,
      holdMaxRpm,
      baroKpa: idle[BARO] ? round1(idle[BARO].avg) : null,
    },
    range,
  );
  lines.push(...result.notes);
  const values = {
    idle: orDash(result.idleDeltaKpa),
    hold: orDash(result.holdDeltaKpa),
    rpm: orDash(holdMaxRpm),
  };
  const findings: SkillFinding[] = result.findings
    .filter((f) => f.id !== 'insufficient')
    .map((f) => ({ key: `${FINDING}boost.${f.id}`, severity: f.severity, values }));
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `Boost: ${result.findings.map((f) => f.id).join(', ')}`,
    findings,
  };
}

// ---- battery and charging ----

/** Module voltage and rpm under load: `0142` when supported, else the adapter's voltage. */
async function loadReading(
  ctx: ProcedureContext,
): Promise<{ volts: number | null; rpm: number | null; source: string }> {
  if (ctx.session.effectivePids().includes(MODULE_V)) {
    const data = await readLive(ctx, [MODULE_V, RPM], LOAD_SECONDS);
    return {
      volts: data[MODULE_V]?.avg ?? null,
      rpm: data[RPM]?.avg ?? null,
      source: 'module voltage 0142',
    };
  }
  const volts: number[] = [];
  const start = ctx.now();
  while (ctx.now() - start < LOAD_SECONDS * 1000 && !ctx.signal.aborted) {
    const v = await ctx.session.voltage();
    if (v !== null) volts.push(v);
    await ctx.sleep(VOLTAGE_SAMPLE_MS);
  }
  const data = await readLive(ctx, [RPM], 0);
  return {
    volts: volts.length ? volts.reduce((a, b) => a + b, 0) / volts.length : null,
    rpm: data[RPM]?.avg ?? null,
    source: 'adapter voltage (0142 not supported)',
  };
}

async function batteryCharging(ctx: ProcedureContext): Promise<ToolResult> {
  const battery = await ctx.runProcedure('battery_capture');
  const lines = [battery.digest];
  const findings: SkillFinding[] = [...(battery.findings ?? [])];
  let charging = 'not judged';

  const missed = driverMissed('electrical load', await ctx.askDriver('electrical_load_on'));
  if (missed) lines.push(`${missed} Charging under load not judged.`);
  else {
    const { volts, rpm, source } = await loadReading(ctx);
    if (volts == null)
      lines.push('No voltage answered under load: charging under load not judged.');
    else if (rpm == null)
      lines.push(
        '010C not answered: engine running not confirmed; charging under load not judged.',
      );
    else if (rpm <= ENGINE_RUNNING_MIN_RPM)
      lines.push(`Engine not running (${Math.round(rpm)} rpm): charging under load not judged.`);
    else {
      const weak = volts < CHARGING_UNDER_LOAD_MIN_V;
      charging = weak ? 'weak under load' : 'ok under load';
      lines.push(
        `Under electrical load: ${oneDecimal(volts)} V (${source}) at ${Math.round(rpm)} rpm; ` +
          (weak
            ? `under ${CHARGING_UNDER_LOAD_MIN_V} V: the alternator does not keep up.`
            : `at or above ${CHARGING_UNDER_LOAD_MIN_V} V: the alternator keeps up.`),
      );
      findings.push({
        key: `${FINDING}charging.${weak ? 'weakUnderLoad' : 'ok'}`,
        severity: weak ? 'warn' : 'ok',
        values: { volts: volts.toFixed(1), rpm: Math.round(rpm) },
      });
    }
    const off = driverMissed('electrical load off', await ctx.askDriver('electrical_load_off'));
    if (off) lines.push(`${off} Remind the driver to switch the loads off.`);
  }
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `${battery.summary}; charging ${charging}`,
    findings,
  };
}

// ---- cooling ----

/** The warm-up curve of the latest cold-start trip, or null with the reason as a digest line. */
async function coldTripCurve(
  ctx: ProcedureContext,
): Promise<{ curve: WarmupCurve | null; line?: string }> {
  if (!ctx.hasTool('read_trip'))
    return { curve: null, line: 'Recorded trips are not available here: no warm-up curve.' };
  const trip = await ctx.callTool('read_trip', { id: 'latest_cold' });
  const samples = (trip.data as { samples?: TripSample[] } | undefined)?.samples;
  if (trip.status === 'error' || !samples)
    return { curve: null, line: `Recorded trips: ${trip.digest}` };
  const curve = warmupCurve(samples);
  return curve
    ? { curve }
    : { curve: null, line: 'The cold-start trip logged no coolant (0105): no warm-up curve.' };
}

async function cooling(ctx: ProcedureContext): Promise<ToolResult> {
  const lines = ['Cooling: coolant now (0105) and the latest recorded cold-start trip.'];
  const now = await readLive(ctx, [COOLANT], 0);
  const currentC = now[COOLANT] ? round1(now[COOLANT].avg) : null;
  if (currentC == null) lines.push('0105 not answered: the coolant temperature now is not judged.');
  const { curve, line } = await coldTripCurve(ctx);
  if (line) lines.push(line);

  const result = assessCooling(currentC, curve, ctx.profile.fuel);
  lines.push(...result.notes);
  const values = {
    now: orDash(currentC),
    max: orDash(curve?.maxC),
    warmup: orDash(curve?.warmupMin),
    driven: orDash(curve?.drivenMin),
  };
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `Cooling: ${result.findings.map((f) => f.id).join(', ')}`,
    findings: result.findings.map((f) => ({
      key: `${FINDING}cooling.${f.id}`,
      severity: f.severity,
      values,
    })),
  };
}

// ---- misfire ----

async function misfire(ctx: ProcedureContext): Promise<ToolResult> {
  const results: Mode06Result[] = [];
  const silent: string[] = [];
  for (const mid of MISFIRE_MIDS) {
    try {
      results.push(...(await ctx.session.readMode06(mid)));
    } catch (e) {
      if (e instanceof Elm327ClosedError) throw e;
      silent.push(mid);
    }
  }
  const lines = ['Misfire counts from the Mode 06 misfire monitors (MID A2-A5 = cylinders 1-4).'];
  if (silent.length) lines.push(`No answer for MID ${silent.join(', ')}.`);
  const a = assessMisfire(results);
  const counts = Object.entries(a.counts)
    .map(([cyl, n]) => `cylinder ${cyl}: ${n}`)
    .join(', ');
  if (a.id === 'no_data') {
    lines.push('No misfire count reported by the car: misfires not judged.');
    return { digest: lines.join('\n'), summary: 'Misfire: not judged (no data)' };
  }
  lines.push(`Counts: ${counts}.`);
  const total = Object.values(a.counts).reduce((s, n) => s + n, 0);
  let values: Record<string, number>;
  if (a.id === 'cylinder') {
    const cylinder = a.cylinder ?? 0;
    values = { cylinder, count: a.counts[cylinder] ?? 0 };
    lines.push(`One cylinder stands out: cylinder ${cylinder}.`);
  } else {
    values = { total };
    lines.push(
      a.id === 'random'
        ? `Misfires spread across cylinders (total ${total}).`
        : `No significant misfires (total ${total}).`,
    );
  }
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `Misfire: ${a.id}`,
    findings: [{ key: `${FINDING}misfire.${a.id}`, severity: a.severity, values }],
  };
}

// ---- playbooks built from other procedures and tools ----

/** Several results as one: each digest under its `[label]`, findings in order. */
function merge(parts: { label: string; result: ToolResult }[], extra: string[] = []): ToolResult {
  const digest = [
    ...parts.map(({ label, result }) => `[${label}] ${result.digest}`),
    ...extra,
  ].join('\n');
  const findings = parts.flatMap(({ result }) => result.findings ?? []);
  return {
    digest: clampDigest(digest),
    summary:
      parts.map(({ label, result }) => `${label}: ${result.summary}`).join('; ') || 'Nothing run',
    ...(findings.length ? { findings } : {}),
    ...(parts.length > 0 && parts.every(({ result }) => result.unconfirmed)
      ? { unconfirmed: true }
      : {}),
  };
}

async function checkEngineLight(ctx: ProcedureContext): Promise<ToolResult> {
  const dtcs = await ctx.callTool('read_dtcs', {});
  const parts = [{ label: 'read_dtcs', result: dtcs }];
  const extra: string[] = [];
  const stored = ((dtcs.data as DtcSet | undefined)?.stored ?? []).map((d) => d.code);
  if (stored.length && ctx.hasTool('read_dtcs_detail')) {
    for (const code of stored.slice(0, CHECK_ENGINE_MAX_DETAILS))
      parts.push({ label: code, result: await ctx.callTool('read_dtcs_detail', { code }) });
    if (stored.length > CHECK_ENGINE_MAX_DETAILS)
      extra.push(
        `${stored.length - CHECK_ENGINE_MAX_DETAILS} more stored codes not detailed: ${stored
          .slice(CHECK_ENGINE_MAX_DETAILS)
          .join(', ')}.`,
      );
  } else if (stored.length) {
    extra.push('Code details are not available here: use the descriptions above.');
  }
  return merge(parts, extra);
}

const LONG_TRIP_CHECKS = ['cooling', 'maintenance', 'dpf'] as const;

async function beforeLongTrip(ctx: ProcedureContext): Promise<ToolResult> {
  const parts: { label: string; result: ToolResult }[] = [];
  const skipped: string[] = [];
  for (const name of LONG_TRIP_CHECKS) {
    if (ctx.signal.aborted) break;
    if (!ctx.hasSkill(name)) skipped.push(name);
    else parts.push({ label: name, result: await ctx.runProcedure(name) });
  }
  return merge(parts, skipped.length ? [`Not available on this car: ${skipped.join(', ')}.`] : []);
}

async function keepsDisconnecting(ctx: ProcedureContext): Promise<ToolResult> {
  const parts = [{ label: 'adapter_health', result: await ctx.runProcedure('adapter_health') }];
  if (ctx.hasTool('read_app_errors'))
    parts.push({
      label: 'app_errors',
      result: await ctx.callTool('read_app_errors', { limit: APP_ERRORS_LIMIT }),
    });
  return merge(parts);
}

/** A feature's procedure under the playbook's name (gated by the playbook's `requires.skills`). */
const delegate =
  (id: string) =>
  (ctx: ProcedureContext): Promise<ToolResult> =>
    ctx.runProcedure(id);

// Adapter time each procedure may take (driver waits excluded). Feature parts use the cost their
// feature declares: read_dpf 4 s, read_inspection 6 s, check_adapter 5 s, read_dtcs_detail 2 s.
const COOLING_COST_MS = readLiveCostMs(0) + 2000;
const DPF_COST_MS = 4000;

export const PLAYBOOK_PROCEDURES: SkillProcedure[] = [
  {
    id: 'fuel_trims',
    costMs: readLiveCostMs(IDLE_TRIM_SECONDS) + readLiveCostMs(HOLD_SECONDS),
    run: fuelTrims,
  },
  {
    id: 'boost',
    costMs: readLiveCostMs(IDLE_BOOST_SECONDS) + readLiveCostMs(HOLD_SECONDS),
    run: boost,
  },
  {
    id: 'battery_charging',
    costMs: BATTERY_MAX_MS + readLiveCostMs(LOAD_SECONDS),
    run: batteryCharging,
  },
  { id: 'cooling', costMs: COOLING_COST_MS, run: cooling },
  { id: 'misfire', costMs: MISFIRE_MIDS.length * 1000, run: misfire },
  { id: 'dpf_regen', costMs: DPF_COST_MS, run: delegate('dpf') },
  { id: 'used_car', costMs: 6000, run: delegate('used_car_check') },
  {
    id: 'check_engine_light',
    costMs: 3000 + CHECK_ENGINE_MAX_DETAILS * 2000,
    run: checkEngineLight,
  },
  { id: 'before_long_trip', costMs: COOLING_COST_MS + DPF_COST_MS, run: beforeLongTrip },
  { id: 'keeps_disconnecting', costMs: 5000, run: keepsDisconnecting },
];
