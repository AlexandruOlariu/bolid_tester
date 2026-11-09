/**
 * Generic SAE J2012 / ISO 15031-6 chassis codes, C0000–C0FFF.
 *
 * Data sourcing rules (plan 05):
 * - Descriptions are the standardized SAE J2012 / ISO 15031-6 definitions, authored for this
 *   project in short canonical wording. Nothing here is copied from a GPL source (python-OBD's
 *   `codes.py` is GPL-2 and must not be used); no third-party list was used.
 * - Keys are uppercase 5-character codes, no duplicates (dtcDatabase.test.ts enforces this).
 * - Deliberately small: only codes whose generic assignment is well established are listed
 *   (ABS pump, wheel speed sensors, steering angle, stability-control inertial sensors).
 *   Uncertain codes (e.g. per-wheel ABS solenoid/valve controls) are omitted; anything missing
 *   falls back to the range description in `dtcDatabase/index.ts`.
 *
 * License: MIT, authored for bolid-tester (see LICENSE at the repository root).
 */
export const C0: Record<string, string> = {
  // ABS hydraulic unit
  C0020: 'ABS Pump Motor Control',

  // Wheel speed sensors
  C0035: 'Left Front Wheel Speed Sensor',
  C0040: 'Right Front Wheel Speed Sensor',
  C0045: 'Left Rear Wheel Speed Sensor',
  C0050: 'Right Rear Wheel Speed Sensor',

  // Steering
  C0051: 'Steering Wheel Position Sensor',

  // Stability control inertial sensors
  C0061: 'Lateral Acceleration Sensor',
  C0062: 'Longitudinal Acceleration Sensor',
  C0063: 'Yaw Rate Sensor',
  C0064: 'Roll Rate Sensor',
};
