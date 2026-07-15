/** Drive-cycle / readiness coach data (6b.9). After a code clear the OBD readiness monitors flip to
 *  "not ready" and only complete once the car has been driven through the right conditions. This is a
 *  pure, static dictionary of GENERIC, APPROXIMATE completion patterns keyed by the standard monitor
 *  name (matching `Monitor.name` in ./readiness). Real drive cycles are manufacturer-specific — the
 *  guidance here is the widely-published generic OBD-II pattern, clearly worded as approximate.
 *
 *  No I/O, no RN deps — the coach (fault-codes feature) looks a monitor up and renders it; EngineHost
 *  edge-detects completion (see `diffReadiness` in ./readiness). See docs/features/fault-codes.md. */

export interface DriveCyclePattern {
  /** Monitor name this pattern completes (matches Monitor.name for the standard set). */
  monitor: string;
  /** One-line, generic summary of what completes this monitor. */
  summary: string;
  /** Short, ordered, generic drive-cycle steps. Approximate — not a manufacturer procedure. */
  steps: string[];
}

/** Shown once in the coach UI — every pattern is generic guidance, not a factory drive cycle. */
export const DRIVE_CYCLE_DISCLAIMER =
  'These are generic OBD-II drive-cycle patterns and are approximate. The exact procedure is ' +
  'manufacturer-specific — drive safely and legally; treat the steps as a rough guide.';

// A cold start (engine off long enough that coolant ≈ intake air, typically several hours / overnight)
// resets most non-continuous monitors' preconditions, so nearly every pattern begins there.
const COLD_START = 'Start cold — engine off for several hours (ideally overnight) so it warms from ambient.';
const WARM_UP = 'Let the engine reach normal operating temperature (a few minutes of driving).';
const STEADY_CRUISE = 'Hold a steady 80 km/h (50 mph) for ~5 minutes on light throttle — no hard acceleration.';

/** The standard monitors, keyed by the exact name ./readiness emits (both spark and compression
 *  ignition variants, so the coach works on petrol and diesel cars alike). */
export const DRIVE_CYCLE_PATTERNS: Record<string, DriveCyclePattern> = {
  // --- Continuous monitors: no special cycle; they run whenever the engine runs. ---
  Misfire: {
    monitor: 'Misfire',
    summary: 'Runs continuously — completes on its own during normal driving.',
    steps: [WARM_UP, 'Drive normally for a few minutes; no special cycle is needed.'],
  },
  'Fuel system': {
    monitor: 'Fuel system',
    summary: 'Runs continuously in closed-loop — completes during normal driving.',
    steps: [WARM_UP, 'Drive normally through a mix of idle, cruise and gentle acceleration.'],
  },
  Components: {
    monitor: 'Components',
    summary: 'Comprehensive component monitor — runs continuously once warm.',
    steps: [WARM_UP, 'Drive normally for a few minutes.'],
  },

  // --- Spark-ignition (petrol) non-continuous monitors. ---
  Catalyst: {
    monitor: 'Catalyst',
    summary: 'Needs a warm engine and a sustained steady-speed cruise.',
    steps: [COLD_START, WARM_UP, STEADY_CRUISE, 'Add a few gentle decelerations (foot off throttle) while rolling.'],
  },
  'Heated catalyst': {
    monitor: 'Heated catalyst',
    summary: 'Like the catalyst monitor — warm engine, steady cruise.',
    steps: [COLD_START, WARM_UP, STEADY_CRUISE],
  },
  'Evaporative system': {
    monitor: 'Evaporative system',
    summary: 'Needs a cold start with the fuel tank roughly 15–85% full and a gentle drive.',
    steps: [
      COLD_START,
      'Keep the tank between about 1/4 and 3/4 full.',
      'Drive gently — avoid hard acceleration; steady cruise helps.',
      'Stable ambient temperature helps; it may take more than one trip.',
    ],
  },
  'Secondary air system': {
    monitor: 'Secondary air system',
    summary: 'Completes soon after a cold start while the air-injection pump runs.',
    steps: [COLD_START, 'Idle and drive gently for the first few minutes after starting.'],
  },
  'A/C refrigerant': {
    monitor: 'A/C refrigerant',
    summary: 'Completes during normal operation once warm.',
    steps: [WARM_UP, 'Drive normally; no special cycle is needed.'],
  },
  'Oxygen sensor': {
    monitor: 'Oxygen sensor',
    summary: 'Needs closed-loop operation at a steady speed.',
    steps: [COLD_START, WARM_UP, STEADY_CRUISE, 'Include some light acceleration and deceleration.'],
  },
  'Oxygen sensor heater': {
    monitor: 'Oxygen sensor heater',
    summary: 'Completes shortly after a cold start once the sensor heaters energise.',
    steps: [COLD_START, 'Idle and drive gently for the first few minutes.'],
  },
  'EGR system': {
    monitor: 'EGR system',
    summary: 'Needs a warm engine, steady cruise and a few gentle decelerations.',
    steps: [COLD_START, WARM_UP, STEADY_CRUISE, 'Lift off the throttle a few times while cruising to let EGR flow.'],
  },

  // --- Compression-ignition (diesel) non-continuous monitors. ---
  'NMHC catalyst': {
    monitor: 'NMHC catalyst',
    summary: 'Needs a warm engine and a sustained cruise.',
    steps: [COLD_START, WARM_UP, STEADY_CRUISE],
  },
  'NOx/SCR monitor': {
    monitor: 'NOx/SCR monitor',
    summary: 'Needs a warm engine and a longer steady highway cruise under light load.',
    steps: [COLD_START, WARM_UP, 'Cruise at a steady highway speed for 10–15 minutes.'],
  },
  'Boost pressure': {
    monitor: 'Boost pressure',
    summary: 'Needs a warm engine and moderate acceleration under load.',
    steps: [
      WARM_UP,
      'Make a few moderate accelerations to load the turbo (safely, in a lower gear).',
      'Follow with a steady highway cruise.',
    ],
  },
  'Exhaust gas sensor': {
    monitor: 'Exhaust gas sensor',
    summary: 'Needs a warm engine and steady cruising.',
    steps: [COLD_START, WARM_UP, STEADY_CRUISE],
  },
  'PM filter': {
    monitor: 'PM filter',
    summary: 'Needs a warm engine and a sustained higher-speed drive (which also helps a DPF regen).',
    steps: [WARM_UP, 'Drive at a steady 90–110 km/h for 15–20 minutes to keep exhaust temperature up.'],
  },
  'EGR/VVT system': {
    monitor: 'EGR/VVT system',
    summary: 'Needs a warm engine, steady cruise and gentle decelerations.',
    steps: [COLD_START, WARM_UP, STEADY_CRUISE, 'Lift off the throttle a few times while cruising.'],
  },
};

/** A generic fallback for any monitor without a specific pattern — the classic OBD-II drive cycle. */
export const GENERIC_DRIVE_CYCLE: DriveCyclePattern = {
  monitor: 'generic',
  summary: 'A generic OBD-II drive cycle usually completes it.',
  steps: [
    COLD_START,
    'Idle ~2 minutes, then drive 20 minutes of mixed city and highway.',
    STEADY_CRUISE,
    'Return to idle, then switch off. Re-read readiness afterwards.',
  ],
};

/** Look up the completion pattern for a monitor by its name, falling back to the generic cycle. */
export function driveCyclePattern(monitorName: string): DriveCyclePattern {
  return DRIVE_CYCLE_PATTERNS[monitorName] ?? { ...GENERIC_DRIVE_CYCLE, monitor: monitorName };
}
