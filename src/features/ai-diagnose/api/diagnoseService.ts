/** Service layer for AI auto-diagnosis: gather a snapshot from the live session, run it through the
 *  AI model (falling back to local rule-based analysis), answer follow-up questions about the report,
 *  and clear codes on request. Talks to the OBD2 core + the AI client dispatcher (`getAiClient`);
 *  holds no React state. See docs/features/ai-diagnose.md. */

import {
  type AiChatMessage,
  type AiReport,
  type DiagnosisOptions,
  type DiagnosticSnapshot,
  type KnownCheck,
  type LiveValue,
  type VehicleContext,
  KEY_DIAGNOSTIC_PIDS,
  aiConfigProblem,
  buildDiagnosisMessages,
  buildFollowUpMessages,
  localHeuristicReport,
  parseAiReport,
  toDtc,
  vagCodeForDtc,
  type Dtc,
} from '@/shared/obd-core';
import { getAiClient } from '@/shared/ai';
import { curatedProfileId, vehicleLabel, type VehicleProfile } from '@/shared/vehicles';
import { GENERIC_GUIDE, matchFaultGuide } from '@/shared/vehicles/faultGuides';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { getActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import { logError } from '@/shared/state/errorLogStore';

export interface AnalysisOutcome {
  report: AiReport;
  /** Non-fatal explanation when we couldn't use the AI model. */
  notice: string | null;
}

/** Map the selected vehicle profile into the AI's default vehicle context. Always returns something
 *  (even for the generic profile) so the model knows what kind of car it is looking at. */
function toVehicleContext(p: VehicleProfile): VehicleContext {
  return {
    label: vehicleLabel(p),
    year: p.year || undefined,
    engine: p.engine && p.engine !== '—' ? p.engine : undefined,
    fuel: p.fuel && p.fuel !== 'other' ? p.fuel : undefined,
    expectedProtocol:
      p.expectedProtocol && p.expectedProtocol !== 'AUTO' ? p.expectedProtocol : undefined,
    notes: p.notes || undefined,
    make: p.make,
  };
}

/** The curated guides (not the generic fallback) that match the read codes on this car, one entry
 *  per distinct guide, listed to the model as "Known checks for this car". */
export function knownChecksFor(profileId: string, codes: string[]): KnownCheck[] {
  const out: KnownCheck[] = [];
  const seen = new Set<object>();
  for (const code of codes) {
    const guide = matchFaultGuide(profileId, code, vagCodeForDtc(code) || undefined);
    if (guide === GENERIC_GUIDE || seen.has(guide)) continue;
    seen.add(guide);
    out.push({ code, note: guide.note });
  }
  return out;
}

/** One read pass over the car: DTCs (per the profile's modes), readiness, freeze frame, and a
 *  one-shot poll of the key supported live PIDs, plus the per-car guides for the read codes. */
export async function gatherSnapshot(): Promise<DiagnosticSnapshot> {
  const { session, info } = useSessionStore.getState();
  if (!session) throw new Error('Not connected to a vehicle.');

  const profile = getActiveProfile();
  const modes = profile.dtcModes;
  // Same make-aware descriptions as the Faults screen (VAG / Fiat text for P1xxx codes).
  const describe = (list: Dtc[]) => list.map((d) => toDtc(d.code, profile.make));
  const stored = describe(modes.includes('03') ? await session.readDtcs('03') : []);
  const pending = describe(modes.includes('07') ? await session.readDtcs('07') : []);
  const permanent = describe(modes.includes('0A') ? await session.readDtcs('0A') : []);
  const readiness = await session.readReadiness();
  const freezeFrame = stored.length > 0 ? await session.readFreezeFrame() : null;

  const supported = new Set(session.effectivePids());
  const pids = KEY_DIAGNOSTIC_PIDS.filter((p) => supported.has(p));
  const polled = await session.pollOnce(pids.length ? pids : [...KEY_DIAGNOSTIC_PIDS]);
  const live: LiveValue[] = Object.values(polled);
  const codes = [...new Set([...stored, ...pending, ...permanent].map((d) => d.code))];
  const guides = knownChecksFor(curatedProfileId(profile), codes);

  return {
    protocol: session.currentProtocol,
    vin: info?.vin ?? null,
    voltage: info?.voltage ?? null,
    supportedPidCount: session.supportedPids.length,
    readiness,
    dtcs: { stored, pending, permanent },
    freezeFrame,
    live,
    vehicle: toVehicleContext(profile),
    ...(guides.length ? { guides } : {}),
  };
}

/** Analyse a snapshot. Uses the configured AI server when available; otherwise (or on any AI error)
 *  returns the deterministic local report with an explanatory notice. Never throws for AI issues.
 *  `opts.focusCode` (from the fault-codes "Explain with AI" action) focuses both paths on one code. */
export async function analyze(
  snapshot: DiagnosticSnapshot,
  onAnalyzing?: () => void,
  opts: DiagnosisOptions = {},
): Promise<AnalysisOutcome> {
  const ai = useSettingsStore.getState().ai;
  const problem = aiConfigProblem(ai);

  if (problem) {
    return {
      report: localHeuristicReport(snapshot, opts),
      notice: `${problem} Showing an on-device rule-based report instead.`,
    };
  }

  onAnalyzing?.();
  try {
    const content = await getAiClient(ai).chat(buildDiagnosisMessages(snapshot, opts), {
      json: true,
    });
    return { report: parseAiReport(content, snapshot), notice: null };
  } catch (e) {
    logError({
      source: 'ai-diagnose',
      error: e,
      severity: 'warning',
      context: { phase: 'analyse', provider: ai.provider, model: ai.model },
    });
    return {
      report: localHeuristicReport(snapshot, opts),
      notice: `AI server unavailable — showing an on-device rule-based report instead. (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

/** Answer one follow-up question about `report` (plan 19): the report, the snapshot and the last
 *  turns of the conversation go to the configured provider as plain text (`json: false`). Throws a
 *  friendly Error when the report came from the on-device rules or the AI is not set up, or when the
 *  model returns nothing. */
export async function followUp(
  snapshot: DiagnosticSnapshot,
  report: AiReport,
  conversation: AiChatMessage[],
  question: string,
): Promise<string> {
  if (report.source === 'local')
    throw new Error(
      'Follow-ups need an AI provider. Set one up in Settings → AI assistant, then re-run the diagnosis.',
    );
  const ai = useSettingsStore.getState().ai;
  const problem = aiConfigProblem(ai);
  if (problem) throw new Error(problem);
  const answer = await getAiClient(ai).chat(
    buildFollowUpMessages(snapshot, report, conversation, question),
    { json: false },
  );
  const text = (answer ?? '').trim();
  if (!text) throw new Error('The AI returned no answer. Try asking again.');
  return text;
}

export async function clearCodes(): Promise<boolean> {
  const { session } = useSessionStore.getState();
  if (!session) return false;
  return session.clearDtcs();
}
