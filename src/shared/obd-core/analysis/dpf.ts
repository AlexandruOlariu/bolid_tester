/** Pure DPF (diesel particulate filter) / regeneration interpretation. The raw figures come from
 *  experimental manufacturer Mode 22 PIDs (see the diesel pack in the VAG profile) — this module only
 *  turns them into a human status + advice, so it is fully unit-testable. See docs/features/dpf.md.
 *
 *  EXPERIMENTAL: the underlying DIDs are manufacturer-specific and unverified on a generic ELM327;
 *  treat absolute values as indicative. The thresholds below are typical for passenger-car DPFs. */

export interface DpfInput {
  sootPct?: number | null; // calculated soot load, 0–100 %
  sootMassG?: number | null; // calculated soot mass, grams
  ashMassG?: number | null; // accumulated ash, grams (non-burnable, lifetime wear)
  kmSinceRegen?: number | null; // distance since last successful regeneration
  regenCount?: number | null; // lifetime successful regenerations
  egtC?: number | null; // exhaust-gas temperature (°C) near the DPF
  regenActive?: boolean | null; // regeneration currently in progress
}

export type DpfStatus = 'ok' | 'filling' | 'regen-due' | 'regenerating' | 'high' | 'unknown';

export interface DpfReport {
  status: DpfStatus;
  sootPct: number | null;
  advice: string;
  flags: string[];
}

const REGEN_EGT_C = 500; // regeneration burns soot at high exhaust temperatures

/** Interpret DPF telemetry into a status + driver advice. */
export function assessDpf(i: DpfInput): DpfReport {
  const flags: string[] = [];
  const sootPct = i.sootPct ?? null;

  if (i.ashMassG != null && i.ashMassG > 0) flags.push(`Ash load ${i.ashMassG.toFixed(1)} g (lifetime — not removed by regen).`);
  if (i.regenCount != null) flags.push(`${i.regenCount} lifetime regenerations.`);
  if (i.kmSinceRegen != null) flags.push(`${Math.round(i.kmSinceRegen)} km since last regen.`);
  if (i.egtC != null) flags.push(`Exhaust temp ${Math.round(i.egtC)} °C.`);

  const active = i.regenActive === true || (i.egtC != null && i.egtC >= REGEN_EGT_C && (sootPct ?? 0) > 0);
  if (active) {
    return {
      status: 'regenerating',
      sootPct,
      advice: 'Regeneration in progress — keep driving at steady speed until it completes; do not switch off.',
      flags,
    };
  }

  if (sootPct == null) {
    return { status: 'unknown', sootPct, advice: 'No soot-load reading available for this car.', flags };
  }

  if (sootPct >= 90) {
    return { status: 'high', sootPct, advice: 'Soot load very high — a forced/service regeneration may be needed; sustained motorway driving can help.', flags };
  }
  if (sootPct >= 70) {
    return { status: 'regen-due', sootPct, advice: 'Soot load high — a regeneration is due; a 15–20 min steady drive at speed usually triggers it.', flags };
  }
  if (sootPct >= 45) {
    return { status: 'filling', sootPct, advice: 'Soot load building normally — no action needed.', flags };
  }
  return { status: 'ok', sootPct, advice: 'Soot load low — filter healthy.', flags };
}
