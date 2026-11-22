/** The sensor-tests feature's contribution to the AI diagnostic agent (plan 34b): `read_mode06`
 *  (the profile's Mode 06 on-board monitor results with value, limits and pass / fail, plus the
 *  Mode 05 O2 sweep on a petrol K-line car, as `useSensorTests` reads them), `wiggle_test` (one PID
 *  watched every 250 ms while the stationary driver flexes its wiring) and the `sensor_tests`
 *  capability skill. Every read goes through the read-only facade. Composed by the app layer
 *  (`src/app/ai-diagnose.tsx`). See docs/features/sensor-tests.md. */

import {
  Elm327ClosedError,
  clampDigest,
  isKLine,
  oneDecimal,
  parseSkillFileOrThrow,
} from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AvailabilityContext,
  DriverReply,
  LiveValue,
  Mode05Result,
  Mode06Result,
  ProtocolId,
  SkillFinding,
  ToolContext,
  ToolResult,
} from '@/shared/obd-core';
import type { VehicleProfile } from '@/shared/vehicles';
import sensorTestsSkill from './sensor_tests.skill.json';

/** Mode 05 TIDs swept on a petrol K-line car (the same sweep as the Sensor tests screen). */
const MODE05_TIDS = ['01', '02', '05', '06'] as const;

export const WIGGLE_SAMPLE_MS = 250;
export const WIGGLE_MIN_SECONDS = 5;
export const WIGGLE_MAX_SECONDS = 15;
export const WIGGLE_DEFAULT_SECONDS = 10;

const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();

/** A test value as the digest shows it: two decimals under 10 (`0.40`), one above (`48.8`). */
const testValue = (n: number): string => (Math.abs(n) < 10 ? n.toFixed(2) : oneDecimal(n));

/** Mode 05 applies only where `useSensorTests` sweeps it: K-line, not a diesel. */
function sweepsMode05(profile: VehicleProfile, protocol: ProtocolId): boolean {
  return isKLine(protocol) && profile.fuel !== 'diesel';
}

function mode06Line(r: Mode06Result): string {
  const unit = r.unit ? ` ${r.unit}` : '';
  return (
    `MID ${hex2(r.mid)} TID ${hex2(r.tid)}: ${testValue(r.value)}${unit} ` +
    `(limits ${testValue(r.min)}–${testValue(r.max)}) ${r.pass ? 'pass' : 'fail'}`
  );
}

function mode05Line(r: Mode05Result): string {
  const value =
    r.volts !== null
      ? `${r.volts.toFixed(2)} V`
      : `raw ${r.values.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}`;
  return `Mode 05 TID ${r.tid} ${r.name} (sensor ${r.sensor}): ${value}`;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function readMode06(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const lines: string[] = [];
  const findings: SkillFinding[] = [];
  let passed = 0;
  let failed = 0;
  for (const test of ctx.profile.mode06Tests ?? []) {
    try {
      for (const r of await ctx.session.readMode06(test.mid)) {
        lines.push(mode06Line(r));
        if (r.pass) {
          passed++;
        } else {
          failed++;
          findings.push({
            key: 'sensorTests:agent.finding.monitorFail',
            severity: 'warn',
            values: { mid: hex2(r.mid), tid: hex2(r.tid) },
          });
        }
      }
    } catch (e) {
      if (e instanceof Elm327ClosedError) throw e;
      lines.push(`MID ${test.mid}: read failed: ${errorText(e)}`);
    }
  }
  let mode05 = 0;
  if (sweepsMode05(ctx.profile, ctx.session.currentProtocol)) {
    for (const tid of MODE05_TIDS) {
      try {
        const r = await ctx.session.readMode05(tid, '01');
        if (r) {
          lines.push(mode05Line(r));
          mode05++;
        }
      } catch (e) {
        if (e instanceof Elm327ClosedError) throw e;
        lines.push(`Mode 05 TID ${tid}: read failed: ${errorText(e)}`);
      }
    }
  }
  if (lines.length === 0) {
    return { digest: 'No Mode 06 results from the car.', summary: 'Mode 06: no results' };
  }
  const parts = [`Mode 06: ${passed} pass, ${failed} fail`];
  if (mode05) parts.push(`Mode 05: ${mode05} results`);
  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: parts.join('; '),
    ...(findings.length ? { findings } : {}),
  };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Why the driver's part did not happen, as a digest line, or null when it did. */
function driverProblem(reply: DriverReply | undefined): string | null {
  if (!reply) return 'Stopped before the driver replied.';
  switch (reply.kind) {
    case 'done':
    case 'choice':
      return null;
    case 'refused':
      return `Driver step refused (${reply.reason === 'moving' ? 'car moving' : 'speed unknown'}).`;
    case 'moving':
      return 'The car moved during the test.';
    case 'cant':
    case 'timeout':
      return 'The driver could not flex the wiring.';
  }
}

async function wiggleTest(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pid = String(args.pid ?? '').toUpperCase();
  const secondsArg =
    typeof args.seconds === 'number' ? Math.floor(args.seconds) : WIGGLE_DEFAULT_SECONDS;
  const seconds = Math.min(WIGGLE_MAX_SECONDS, Math.max(WIGGLE_MIN_SECONDS, secondsArg));
  if (!ctx.session.effectivePids().includes(pid)) {
    return {
      digest: `${pid} is not supported on this car: choose a supported PID.`,
      summary: `Wiggle test: ${pid} not supported`,
      status: 'error',
    };
  }

  // The driver prompt opens while the PID is watched (as the battery capture does); the outcome is
  // recorded, never left unhandled. After a Stop the prompt is not opened at all.
  const driver: { settled: boolean; reply?: DriverReply; failed: boolean; error?: unknown } = {
    settled: false,
    failed: false,
  };
  const waiting = ctx.signal.aborted
    ? null
    : ctx.askDriver('wiggle_connector').then(
        (reply) => {
          driver.reply = reply;
          driver.settled = true;
        },
        (error: unknown) => {
          driver.failed = true;
          driver.error = error;
          driver.settled = true;
        },
      );

  // A NO DATA answer (or a timed-out read) is a dropout and breaks the step sequence.
  const samples: (number | null)[] = [];
  let meta: LiveValue | null = null;
  const start = ctx.now();
  const end = start + seconds * 1000;
  for (let tick = start; tick < end && !ctx.signal.aborted; tick += WIGGLE_SAMPLE_MS) {
    // A driver who cannot do the step (or a refused prompt) ends the watch early.
    if (driver.settled && driverProblem(driver.reply) !== null) break;
    const wait = tick - ctx.now();
    if (wait > 0) await ctx.sleep(wait);
    if (ctx.now() >= end || ctx.signal.aborted) break;
    try {
      const v = await ctx.session.readValue(pid);
      if (v && !meta) meta = v;
      samples.push(v ? v.value : null);
    } catch (e) {
      if (e instanceof Elm327ClosedError) throw e;
      samples.push(null);
    }
  }
  // The driver gate settles on its own timeout; after a Stop, report over what was gathered.
  if (waiting && !driver.settled && !ctx.signal.aborted) await waiting;
  if (driver.failed) throw driver.error;

  const name = meta ? `${pid} ${meta.name}` : pid;
  const unit = meta?.unit ? ` ${meta.unit}` : '';
  const head = `Wiggle test ${name} (${seconds} s, ${samples.length} reads every 0.25 s)`;
  const problem = driverProblem(driver.reply);
  if (problem) {
    return {
      digest: `${head}: not judged. ${problem}`,
      summary: `Wiggle test ${pid}: not done`,
    };
  }

  const values = samples.filter((v): v is number => v !== null);
  const dropouts = samples.length - values.length;
  const findings: SkillFinding[] = [];
  if (dropouts >= 1) {
    findings.push({
      key: 'sensorTests:agent.finding.wiggleDropout',
      severity: 'warn',
      values: { pid, count: dropouts },
    });
  }
  if (values.length === 0) {
    return {
      digest: `${head}: no answer from the car; NO DATA dropouts ${dropouts}.`,
      summary: `Wiggle test ${pid}: no answer`,
      findings,
    };
  }

  const steps: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a !== null && b !== null) steps.push(Math.abs(b - a));
  }
  const largest = steps.length ? Math.max(...steps) : 0;
  const medianStep = steps.length ? median(steps) : 0;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (largest > 0 && largest >= 3 * medianStep && largest >= 0.1 * Math.abs(avg)) {
    findings.push({
      key: 'sensorTests:agent.finding.wiggleUnstable',
      severity: 'info',
      values: { pid, step: oneDecimal(largest), unit: meta?.unit ?? '' },
    });
  }
  const digest =
    `${head}: min ${oneDecimal(min)} / max ${oneDecimal(max)}${unit}; ` +
    `NO DATA dropouts ${dropouts}; ` +
    `largest step ${oneDecimal(largest)}${unit} (median step ${oneDecimal(medianStep)}${unit}).`;
  return {
    digest: clampDigest(digest),
    summary:
      `Wiggle test ${pid}: ${oneDecimal(min)}–${oneDecimal(max)}${unit}, ` +
      `${dropouts} dropouts, largest step ${oneDecimal(largest)}${unit}`,
    ...(findings.length ? { findings } : {}),
  };
}

const readMode06Tool: AgentTool = {
  name: 'read_mode06',
  description:
    "Read the car's on-board monitor test results (Mode 06): each test's value, its limits and " +
    'pass / fail. On a petrol K-line car also the Mode 05 O2-sensor results.',
  labelKey: 'sensorTests:agent.tool.read_mode06',
  args: { type: 'object', properties: {} },
  costMs: 4000,
  available: (ctx: AvailabilityContext) =>
    (ctx.profile.mode06Tests?.length ?? 0) > 0 || sweepsMode05(ctx.profile, ctx.protocol),
  run: readMode06,
};

const wiggleTestTool: AgentTool = {
  name: 'wiggle_test',
  description:
    'Watch one Mode 01 PID every 0.25 s while the stationary driver flexes its wiring and ' +
    'connector: min / max, NO DATA dropouts and the largest jump between two reads.',
  labelKey: 'sensorTests:agent.tool.wiggle_test',
  args: {
    type: 'object',
    properties: {
      pid: {
        type: 'string',
        pattern: '^01[0-9A-F]{2}$',
        description: 'The Mode 01 PID of the sensor to watch, e.g. "010B".',
      },
      seconds: {
        type: 'integer',
        minimum: WIGGLE_MIN_SECONDS,
        maximum: WIGGLE_MAX_SECONDS,
        description: `How long to watch, ${WIGGLE_MIN_SECONDS}-${WIGGLE_MAX_SECONDS} s (default ${WIGGLE_DEFAULT_SECONDS}).`,
      },
    },
    required: ['pid'],
  },
  // A tool declares one cost, so it is the longest call: the full 15 s window.
  costMs: 1000 + WIGGLE_MAX_SECONDS * 1000,
  available: () => true,
  run: wiggleTest,
};

export const agentTools: AgentContribution = {
  tools: [readMode06Tool, wiggleTestTool],
  skills: [parseSkillFileOrThrow(sensorTestsSkill, 'sensor_tests')],
};
