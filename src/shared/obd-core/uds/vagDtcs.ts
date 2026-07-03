/** Seed dictionary of common VAG 5-digit fault-code texts (the numbers VCDS shows for
 *  component/module faults). Community-extensible — entries are widely-published VCDS labels and
 *  must still be confirmed against the real car/module. Generic SAE P/C/B/U codes are described by
 *  the generic dictionary in obd/dtc.ts; this table adds the VAG-numbered ones on top. */
export const VAG_DTC_TEXTS: Record<string, string> = {
  '00281': 'Vehicle speed sensor (G68) — implausible signal',
  '00522': 'Engine coolant temperature sensor (G62) — open/short circuit',
  '00532': 'Supply voltage B+ — signal too low / implausible',
  '00550': 'Start of injection regulation — control deviation',
  '00575': 'Intake manifold pressure — implausible signal / control deviation',
  '00668': 'Supply voltage terminal 30 — signal too low',
  '00779': 'Outside air temperature sensor (G17) — open/short circuit',
  '01044': 'Control module incorrectly coded',
  '01299': 'Diagnostic interface for data bus (J533) — no communication',
  '01312': 'Powertrain data bus — defective',
  '01314': 'Engine control module — no communication',
  '16618': 'Boost condition: overboost (P0234)',
  '17965': 'Charge pressure control: positive deviation (P1557)',
  '65535': 'Internal control module memory error',
};

/** Text for a VAG 5-digit code, or null when the seed dictionary does not know it. */
export function vagDtcText(vagCode: string): string | null {
  return VAG_DTC_TEXTS[vagCode.padStart(5, '0')] ?? null;
}
