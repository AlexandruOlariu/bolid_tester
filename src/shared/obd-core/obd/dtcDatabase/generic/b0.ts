/**
 * Generic SAE J2012 / ISO 15031-6 body codes, B0000–B0FFF.
 *
 * Data sourcing rules (plan 05):
 * - Descriptions are the standardized SAE J2012 / ISO 15031-6 definitions, authored for this
 *   project in short canonical wording. Nothing here is copied from a GPL source (python-OBD's
 *   `codes.py` is GPL-2 and must not be used); no third-party list was used.
 * - Keys are uppercase 5-character codes, no duplicates (dtcDatabase.test.ts enforces this).
 * - Deliberately small: only codes whose generic assignment is well established are listed
 *   (restraint deployment controls, seatbelt sensors, occupant detection, frontal crash sensor).
 *   Uncertain codes are omitted; anything missing falls back to the range description in
 *   `dtcDatabase/index.ts`.
 */
export const B0: Record<string, string> = {
  // Restraints — frontal airbag deployment
  B0001: 'Driver Frontal Stage 1 Deployment Control',
  B0002: 'Driver Frontal Stage 2 Deployment Control',
  B0010: 'Passenger Frontal Stage 1 Deployment Control',
  B0011: 'Passenger Frontal Stage 2 Deployment Control',

  // Restraints — side airbag deployment
  B0020: 'Left Side Airbag Deployment Control',
  B0028: 'Right Side Airbag Deployment Control',

  // Restraints — seatbelt and occupant sensing
  B0050: 'Driver Seatbelt Sensor',
  B0052: 'Passenger Seatbelt Sensor',
  B0081: 'Passenger Presence System',

  // Restraints — crash sensors
  B0100: 'Electronic Frontal Sensor 1',
};
