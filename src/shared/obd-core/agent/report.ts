/** The AI diagnostic agent's reports (plan 34a): the model's final report kept only where it cites
 *  the trail (findings citing no successful step are dropped and counted; findings resting only on
 *  unconfirmed data are capped at `info` and tagged), and the on-device rule report every other
 *  ending falls back to, built from the triage snapshot plus the findings the tools computed.
 *  See docs/features/ai-diagnose.md. */

import {
  DISCLAIMER_AI,
  localHeuristicReport,
  localSummary,
  overallFromFindings,
  sanitizeActions,
  sanitizeFindings,
  type AiFinding,
  type DiagSeverity,
  type DiagnosticSnapshot,
  type AiReport,
} from '../analysis/aiDiagnosis';
import type { AgentStep, FindingTranslator } from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unconfirmed data supports at most `info`; `ok` stays `ok`. */
function capUnconfirmed(severity: DiagSeverity): DiagSeverity {
  return severity === 'warn' || severity === 'critical' ? 'info' : severity;
}

/** The cited step ids that name a successful trail step, in order, without duplicates. */
function validCitations(raw: unknown, okSteps: ReadonlyMap<number, AgentStep>): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const id of raw)
    if (typeof id === 'number' && Number.isInteger(id) && okSteps.has(id) && !out.includes(id))
      out.push(id);
  return out;
}

/** Whether a finding's `codes` rest only on unconfirmed data in the cited steps: every code appears
 *  there in a tool finding flagged unconfirmed (or in an unconfirmed step's findings) and in no
 *  confirmed finding and no confirmed read (`confirmedCodes`). This catches a triage step, which is
 *  confirmed overall, carrying `scan_modules` codes from modules whose addressing is unverified. */
function codesOnlyUnconfirmed(codes: string[] | undefined, steps: AgentStep[]): boolean {
  if (!codes?.length) return false;
  const unconfirmed = new Set<string>();
  const confirmed = new Set<string>();
  for (const s of steps) {
    for (const c of s.confirmedCodes ?? []) confirmed.add(c.toUpperCase());
    for (const f of s.findings ?? []) {
      const target = f.unconfirmed === true || s.unconfirmed === true ? unconfirmed : confirmed;
      for (const c of f.codes ?? []) target.add(c.toUpperCase());
    }
  }
  return codes.every((c) => {
    const code = c.toUpperCase();
    return unconfirmed.has(code) && !confirmed.has(code);
  });
}

/** The model's `final` object as a report, or null when it has neither a summary nor a finding
 *  that cites a successful step. `overall` is recomputed from the kept findings. */
export function parseAgentFinal(final: unknown, trail: AgentStep[]): AiReport | null {
  if (!isPlainObject(final)) return null;
  const okSteps = new Map(trail.filter((s) => s.status === 'ok').map((s) => [s.id, s]));

  const findings: AiFinding[] = [];
  let dropped = 0;
  for (const raw of Array.isArray(final.findings) ? final.findings : []) {
    const [finding] = sanitizeFindings([raw]);
    if (!finding) continue;
    const steps = validCitations(isPlainObject(raw) ? raw.steps : undefined, okSteps);
    if (steps.length === 0) {
      dropped++;
      continue;
    }
    const cited = steps.map((id) => okSteps.get(id)).filter((s): s is AgentStep => !!s);
    const unconfirmed =
      cited.every((s) => s.unconfirmed === true) || codesOnlyUnconfirmed(finding.codes, cited);
    findings.push(
      unconfirmed
        ? { ...finding, severity: capUnconfirmed(finding.severity), steps, unconfirmed: true }
        : { ...finding, steps },
    );
  }

  const summary = typeof final.summary === 'string' ? final.summary.trim() : '';
  if (!summary && findings.length === 0) return null;
  return {
    overall: overallFromFindings(findings),
    summary: summary || 'Analysis complete.',
    findings,
    actions: sanitizeActions(final.actions),
    source: 'ai',
    disclaimer: DISCLAIMER_AI,
    ...(dropped > 0 ? { uncitedDropped: dropped } : {}),
  };
}

/** The on-device rule report over what a run gathered: the rule checks on the triage snapshot (each
 *  citing step 1) plus one translated finding per tool finding in the trail, citing its step. */
export function agentRuleReport(
  snapshot: DiagnosticSnapshot,
  trail: AgentStep[],
  opts: { focusCode?: string; translate: FindingTranslator },
): AiReport {
  const base = localHeuristicReport(snapshot, { focusCode: opts.focusCode });
  const findings: AiFinding[] = base.findings.map((f) => ({ ...f, steps: [1] }));
  for (const step of trail) {
    for (const f of step.findings ?? []) {
      const { title, detail } = opts.translate(f);
      const unconfirmed = f.unconfirmed === true || step.unconfirmed === true;
      findings.push({
        title,
        severity: unconfirmed ? capUnconfirmed(f.severity) : f.severity,
        detail,
        ...(f.codes?.length ? { codes: [...f.codes] } : {}),
        steps: [step.id],
        ...(unconfirmed ? { unconfirmed: true } : {}),
      });
    }
  }
  return {
    ...base,
    overall: overallFromFindings(findings),
    summary: localSummary(findings),
    findings,
    source: 'local',
  };
}
