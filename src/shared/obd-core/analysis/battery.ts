/** Pure battery / charging-system analysis from a system-voltage time series. Voltage comes from the
 *  ELM327 `ATRV` reading or Mode 01 PID 42 (control-module voltage); this module just interprets a
 *  series of `{ t, v }` samples. No device I/O. See docs/features/battery-health.md.
 *
 *  Thresholds are for a conventional 12 V lead-acid system. A "cranking dip" is the brief voltage sag
 *  while the starter turns the engine; a healthy battery holds well above 9.6 V cranking and the
 *  alternator then charges at ~13.6–14.8 V. */

export interface VSample {
  t: number; // epoch ms
  v: number; // volts
}

export type BatteryVerdict = 'good' | 'fair' | 'weak' | 'unknown';

export interface BatteryReport {
  restingV: number | null; // engine-off / pre-start settled voltage
  crankingDipV: number | null; // lowest voltage seen (the crank sag)
  chargingV: number | null; // alternator output while running
  socPct: number | null; // state of charge estimated from resting voltage
  verdict: BatteryVerdict;
  notes: string[];
}

const CHARGING_MIN = 13.2; // above this we treat the alternator as charging

/** Estimate state-of-charge (%) from a rested open-circuit voltage (12 V lead-acid). Clamped 0–100. */
export function socFromResting(v: number): number {
  // 12.60 V ≈ 100 %, 11.80 V ≈ 0 % (roughly linear across the usable band).
  const pct = ((v - 11.8) / (12.6 - 11.8)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Analyze a voltage capture into resting / cranking / charging figures + an overall verdict.
 *  The capture may contain any subset of phases; missing figures are reported as null. */
export function analyzeBattery(samples: VSample[]): BatteryReport {
  const notes: string[] = [];
  const vs = samples.map((s) => s.v).filter((v) => Number.isFinite(v) && v > 0);
  if (vs.length === 0) {
    return { restingV: null, crankingDipV: null, chargingV: null, socPct: null, verdict: 'unknown', notes: ['No voltage samples.'] };
  }

  const firstChargeIdx = samples.findIndex((s) => s.v >= CHARGING_MIN);
  const preStart = (firstChargeIdx < 0 ? samples : samples.slice(0, firstChargeIdx))
    .map((s) => s.v)
    .filter((v) => v >= 11 && v < CHARGING_MIN);
  const restingV = median(preStart);

  const minV = Math.min(...vs);
  // Only call it a "cranking dip" if there is a real sag below the resting band.
  const crankingDipV = minV < 11 ? minV : null;

  const chargingSamples = vs.filter((v) => v >= CHARGING_MIN);
  const chargingV = median(chargingSamples);

  const socPct = restingV != null ? socFromResting(restingV) : null;

  let verdict: BatteryVerdict = 'unknown';
  if (crankingDipV != null) {
    verdict = crankingDipV >= 10 ? 'good' : crankingDipV >= 9.0 ? 'fair' : 'weak';
    notes.push(
      crankingDipV >= 10
        ? `Cranking voltage held at ${crankingDipV.toFixed(1)} V — healthy.`
        : crankingDipV >= 9.0
          ? `Cranking dipped to ${crankingDipV.toFixed(1)} V — marginal; consider testing the battery.`
          : `Cranking dropped to ${crankingDipV.toFixed(1)} V — weak battery or starter draw.`,
    );
  } else if (socPct != null) {
    verdict = socPct >= 75 ? 'good' : socPct >= 50 ? 'fair' : 'weak';
    notes.push(`Resting ${restingV?.toFixed(2)} V ≈ ${socPct}% state of charge.`);
  }

  if (chargingV != null) {
    const chargingOk = chargingV >= 13.6 && chargingV <= 14.8;
    if (chargingV < 13.6) notes.push(`Charging only ${chargingV.toFixed(1)} V — possible weak alternator/regulator.`);
    else if (chargingV > 14.8) notes.push(`Charging ${chargingV.toFixed(1)} V — high; check the regulator.`);
    else notes.push(`Alternator charging at ${chargingV.toFixed(1)} V — normal.`);
    // With no resting/cranking data, base the verdict on the charging voltage alone.
    if (verdict === 'unknown') verdict = chargingOk ? 'good' : 'fair';
  }

  return { restingV, crankingDipV, chargingV, socPct, verdict, notes };
}
