/** Service layer for AI auto-diagnosis: gather a snapshot from the live session, run it through the
 *  AI model (falling back to local rule-based analysis), and clear codes on request. Talks to the
 *  OBD2 core + the OpenAI-compatible client; holds no React state. See docs/features/ai-diagnose.md. */

import {
  type AiReport,
  type DiagnosticSnapshot,
  type LiveValue,
  type VehicleContext,
  KEY_DIAGNOSTIC_PIDS,
  buildDiagnosisMessages,
  localHeuristicReport,
  normalizeBaseUrl,
  parseAiReport,
} from '@/shared/obd-core';
import { chatCompletion } from '@/shared/ai';
import { getVehicleProfile, vehicleLabel, type VehicleProfile } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';

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
    expectedProtocol: p.expectedProtocol && p.expectedProtocol !== 'AUTO' ? p.expectedProtocol : undefined,
    notes: p.notes || undefined,
  };
}

/** One read pass over the car: DTCs (per the profile's modes), readiness, freeze frame, and a
 *  one-shot poll of the key supported live PIDs. */
export async function gatherSnapshot(): Promise<DiagnosticSnapshot> {
  const { session, info } = useSessionStore.getState();
  if (!session) throw new Error('Not connected to a vehicle.');

  const profile = getVehicleProfile(useVehicleStore.getState().selectedProfileId);
  const modes = profile.dtcModes;
  const stored = modes.includes('03') ? await session.readDtcs('03') : [];
  const pending = modes.includes('07') ? await session.readDtcs('07') : [];
  const permanent = modes.includes('0A') ? await session.readDtcs('0A') : [];
  const readiness = await session.readReadiness();
  const freezeFrame = stored.length > 0 ? await session.readFreezeFrame() : null;

  const supported = new Set(session.effectivePids());
  const pids = KEY_DIAGNOSTIC_PIDS.filter((p) => supported.has(p));
  const polled = await session.pollOnce(pids.length ? pids : [...KEY_DIAGNOSTIC_PIDS]);
  const live: LiveValue[] = Object.values(polled);

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
  };
}

/** Analyse a snapshot. Uses the configured AI server when available; otherwise (or on any AI error)
 *  returns the deterministic local report with an explanatory notice. Never throws for AI issues. */
export async function analyze(
  snapshot: DiagnosticSnapshot,
  onAnalyzing?: () => void,
): Promise<AnalysisOutcome> {
  const ai = useSettingsStore.getState().ai;
  const configured = ai.enabled && !!normalizeBaseUrl(ai.baseUrl) && !!ai.model;

  if (!configured) {
    return {
      report: localHeuristicReport(snapshot),
      notice: ai.enabled
        ? 'No AI server configured — showing an on-device rule-based report. Add a server in Settings → AI assistant.'
        : 'AI is turned off — showing an on-device rule-based report. Enable it in Settings → AI assistant.',
    };
  }

  onAnalyzing?.();
  try {
    const content = await chatCompletion(buildDiagnosisMessages(snapshot), ai);
    return { report: parseAiReport(content, snapshot), notice: null };
  } catch (e) {
    return {
      report: localHeuristicReport(snapshot),
      notice: `AI server unavailable — showing an on-device rule-based report instead. (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

export async function clearCodes(): Promise<boolean> {
  const { session } = useSessionStore.getState();
  if (!session) return false;
  return session.clearDtcs();
}
