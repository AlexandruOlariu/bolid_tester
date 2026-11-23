/** Triage, step 1 of every AI diagnostic agent run (plan 34a): the same read pass as the classic
 *  diagnosis (DTCs per the profile's modes, readiness, freeze frame when codes are stored, one poll of
 *  the supported key PIDs, adapter voltage), then every registered tool that asks to run at triage.
 *  The resulting snapshot feeds the on-device rule report. See docs/features/ai-diagnose.md. */

import {
  KEY_DIAGNOSTIC_PIDS,
  summarizeSnapshot,
  type DiagnosticSnapshot,
  type KnownCheck,
} from '../analysis/aiDiagnosis';
import { Elm327ClosedError } from '../elm327/Elm327Client';
import { readProfileDtcs } from './coreTools';
import { MAX_DIGEST_CHARS, clampDigest, fitSections } from './digest';
import type { AgentRegistry } from './registry';
import type { AgentStep, AvailabilityContext, SkillFinding, ToolContext } from './types';

/** The snapshot summary's own cap inside the triage digest. */
export const TRIAGE_SNAPSHOT_CHARS = 1400;
/** The triage digest's length cap: the snapshot summary plus room for two triage tool sections at
 *  their full cap (`scan_modules`, `read_history`), so neither is cut. Each part has its own budget:
 *  the snapshot is clamped to {@link TRIAGE_SNAPSHOT_CHARS}, and the tool sections share the rest
 *  fairly (`fitSections`), so the last section is never the one that is lost. */
export const TRIAGE_DIGEST_CHARS = TRIAGE_SNAPSHOT_CHARS + 2 * (MAX_DIGEST_CHARS + 100);

export interface TriageResult {
  snapshot: DiagnosticSnapshot;
  step: AgentStep;
}

/** The triage digest: the snapshot summary within its own cap, then the tool sections fitted into
 *  the room left with a fair share each. */
export function triageDigest(snapshotSummary: string, sections: string[]): string {
  const head = clampDigest(snapshotSummary, TRIAGE_SNAPSHOT_CHARS);
  if (sections.length === 0) return head;
  const room = TRIAGE_DIGEST_CHARS - head.length - 2;
  return `${head}\n\n${fitSections(sections, room, '\n\n')}`;
}

/** Read the car once and run the triage tools; `knownChecks` gives the curated guides for the read
 *  codes. A closed link (`Elm327ClosedError`) propagates; any other triage-tool failure is recorded
 *  in the digest as `Read failed: <message>` and triage goes on. */
export async function runTriage(
  ctx: ToolContext,
  reg: AgentRegistry,
  knownChecks: (codes: string[]) => KnownCheck[],
): Promise<TriageResult> {
  const started = ctx.now();
  const { session } = ctx;

  const dtcs = await readProfileDtcs(session, ctx.profile);
  const readiness = await session.readReadiness();
  const freezeFrame = dtcs.stored.length > 0 ? await session.readFreezeFrame() : null;
  const supported = new Set(session.effectivePids());
  const pids = KEY_DIAGNOSTIC_PIDS.filter((p) => supported.has(p));
  const polled = await session.pollOnce(pids.length ? pids : [...KEY_DIAGNOSTIC_PIDS]);
  const voltage = await session.voltage();
  const codes = [
    ...new Set([...dtcs.stored, ...dtcs.pending, ...dtcs.permanent].map((d) => d.code)),
  ];
  const guides = knownChecks(codes);

  const snapshot: DiagnosticSnapshot = {
    protocol: session.currentProtocol,
    vin: ctx.vin,
    voltage,
    supportedPidCount: session.supportedPids.length,
    readiness,
    dtcs,
    freezeFrame,
    live: Object.values(polled),
    vehicle: ctx.vehicle,
    ...(guides.length ? { guides } : {}),
  };

  const availability: AvailabilityContext = {
    profile: ctx.profile,
    protocol: session.currentProtocol,
    supportedPids: session.supportedPids,
    canMonitor: session.canMonitor,
  };
  const sections: string[] = [];
  const findings: SkillFinding[] = [];
  for (const tool of reg.tools.values()) {
    if (!tool.triage || !tool.available(availability)) continue;
    try {
      const r = await tool.run(tool.triage.args, ctx);
      sections.push(`## ${tool.name}\n${r.digest}`);
      findings.push(...(r.findings ?? []));
    } catch (e) {
      if (e instanceof Elm327ClosedError) throw e;
      sections.push(`## ${tool.name}\nRead failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const volts = voltage === null ? '—' : voltage.toFixed(1);
  return {
    snapshot,
    step: {
      id: 1,
      kind: 'triage',
      why: '',
      digest: triageDigest(summarizeSnapshot(snapshot), sections),
      summary: `Triage: ${codes.length} codes, battery ${volts} V`,
      label: { key: 'aiDiagnose:agent.step.triage', values: { count: codes.length, volts } },
      status: 'ok',
      findings,
      ...(codes.length ? { confirmedCodes: codes } : {}),
      durationMs: ctx.now() - started,
    },
  };
}
