/** The `battery_capture` skill procedure (plan 34a): samples the adapter voltage while the
 *  (stationary) driver restarts the engine, then reads resting / cranking-dip / charging voltages
 *  with `analyzeBattery`. Sampling and the driver wait run together: the sampler stops 4 s after the
 *  driver replied, or at 30 s. See docs/features/ai-diagnose.md and docs/features/battery-health.md. */

import type { DiagSeverity } from '../../analysis/aiDiagnosis';
import { analyzeBattery, type BatteryVerdict, type VSample } from '../../analysis/battery';
import type { DriverReply, ProcedureContext, SkillProcedure, ToolResult } from '../types';

export const BATTERY_SAMPLE_MS = 200;
/** Engine-off sampling before the driver is asked to restart. */
export const BATTERY_PRE_MS = 2000;
/** Sampling after the driver's reply: the crank and the alternator coming in. */
export const BATTERY_POST_MS = 4000;
/** Hard cap on the whole capture. */
export const BATTERY_MAX_MS = 30_000;

const SEVERITY: Record<BatteryVerdict, DiagSeverity> = {
  good: 'ok',
  fair: 'info',
  weak: 'warn',
  unknown: 'info',
};

const NO_DIP = 'cranking dip not measured.';

const volts = (v: number | null): string => (v === null ? '—' : v.toFixed(1));

/** How the driver's part went, as a digest line, or null when the restart happened in the window. */
function driverLine(reply: DriverReply | undefined, inWindow: boolean): string | null {
  if (!reply) return `Stopped before the driver replied: ${NO_DIP}`;
  switch (reply.kind) {
    case 'cant':
    case 'timeout':
    case 'moving':
      return `Driver could not restart: ${NO_DIP}`;
    case 'refused':
      return `Driver step refused (${reply.reason === 'moving' ? 'car moving' : 'speed unknown'}): ${NO_DIP}`;
    case 'done':
    case 'choice':
      return inWindow ? null : `The 30 s capture ended before the driver replied: ${NO_DIP}`;
  }
}

async function captureBattery(ctx: ProcedureContext): Promise<ToolResult> {
  const start = ctx.now();
  const samples: VSample[] = [];
  const sample = async () => {
    const v = await ctx.session.voltage();
    if (v !== null) samples.push({ t: ctx.now(), v });
  };

  while (ctx.now() - start < BATTERY_PRE_MS && !ctx.signal.aborted) {
    await sample();
    await ctx.sleep(BATTERY_SAMPLE_MS);
  }

  // The driver prompt opens while sampling goes on; the outcome is recorded, never left unhandled.
  // After a Stop the prompt is not opened at all.
  const driver: {
    settled: boolean;
    at: number;
    reply?: DriverReply;
    failed: boolean;
    error?: unknown;
  } = { settled: false, at: 0, failed: false };
  const settle = (at: number) => {
    driver.settled = true;
    driver.at = at;
  };
  const waiting = ctx.signal.aborted
    ? null
    : ctx.askDriver('restart_engine').then(
        (reply) => {
          driver.reply = reply;
          settle(ctx.now());
        },
        (error: unknown) => {
          driver.failed = true;
          driver.error = error;
          settle(ctx.now());
        },
      );

  while (!ctx.signal.aborted && ctx.now() - start < BATTERY_MAX_MS) {
    if (driver.settled && (driver.failed || ctx.now() - driver.at >= BATTERY_POST_MS)) break;
    await sample();
    await ctx.sleep(BATTERY_SAMPLE_MS);
  }
  const inWindow = driver.settled;
  // The driver gate settles on its own timeout; after a Stop, report over what was gathered.
  if (waiting && !driver.settled && !ctx.signal.aborted) await waiting;
  if (driver.failed) throw driver.error;

  const report = analyzeBattery(samples);
  const values = {
    resting: volts(report.restingV),
    dip: volts(report.crankingDipV),
    charging: volts(report.chargingV),
  };
  const v = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)} V`);
  const seconds = Math.round((ctx.now() - start) / 100) / 10;
  const lines = [
    `Battery capture: ${samples.length} voltage samples over ${seconds} s.`,
    `Resting ${v(report.restingV)}, cranking dip ${v(report.crankingDipV)}, charging ${v(report.chargingV)}.`,
    `State of charge: ${report.socPct === null ? '—' : `${report.socPct} %`}.`,
  ];
  const said = driverLine(driver.reply, inWindow);
  if (said) lines.push(said);
  if (report.notes.length) lines.push(`Notes: ${report.notes.join(' ')}`);
  lines.push(`Verdict: ${report.verdict}.`);

  return {
    digest: lines.join('\n'),
    summary: `Battery ${report.verdict}: resting ${v(report.restingV)}, dip ${v(report.crankingDipV)}, charging ${v(report.chargingV)}`,
    findings: [
      {
        key: `aiDiagnose:agent.finding.battery.${report.verdict}`,
        severity: SEVERITY[report.verdict],
        values,
      },
    ],
  };
}

export const batteryCaptureProcedure: SkillProcedure = {
  id: 'battery_capture',
  costMs: BATTERY_MAX_MS,
  run: captureBattery,
};
