/** Mode 01 PID registry: declarative descriptors with pure decoders.
 *  Formulas are documented in docs/obd2-reference.md. `d` holds the data bytes
 *  AFTER the `41 <pid>` header, so d[0]=A, d[1]=B, ... */

export interface PidDescriptor {
  pid: string; // 4-char request, e.g. '010C'
  name: string;
  unit: string;
  bytes: number; // expected data byte count
  decode: (d: number[]) => number;
}

const def = (
  pid: string,
  name: string,
  unit: string,
  bytes: number,
  decode: (d: number[]) => number,
): PidDescriptor => ({ pid, name, unit, bytes, decode });

export const PID_REGISTRY: Record<string, PidDescriptor> = {
  '0104': def('0104', 'Engine load', '%', 1, (d) => (d[0] * 100) / 255),
  '0105': def('0105', 'Coolant temp', '°C', 1, (d) => d[0] - 40),
  '0106': def('0106', 'Short fuel trim B1', '%', 1, (d) => ((d[0] - 128) * 100) / 128),
  '0107': def('0107', 'Long fuel trim B1', '%', 1, (d) => ((d[0] - 128) * 100) / 128),
  '010A': def('010A', 'Fuel pressure', 'kPa', 1, (d) => d[0] * 3),
  '010B': def('010B', 'Intake MAP', 'kPa', 1, (d) => d[0]),
  '010C': def('010C', 'Engine RPM', 'rpm', 2, (d) => (d[0] * 256 + d[1]) / 4),
  '010D': def('010D', 'Vehicle speed', 'km/h', 1, (d) => d[0]),
  '010E': def('010E', 'Timing advance', '°', 1, (d) => d[0] / 2 - 64),
  '010F': def('010F', 'Intake air temp', '°C', 1, (d) => d[0] - 40),
  '0110': def('0110', 'MAF', 'g/s', 2, (d) => (d[0] * 256 + d[1]) / 100),
  '0111': def('0111', 'Throttle', '%', 1, (d) => (d[0] * 100) / 255),
  '011F': def('011F', 'Run time', 's', 2, (d) => d[0] * 256 + d[1]),
  '0121': def('0121', 'Distance with MIL', 'km', 2, (d) => d[0] * 256 + d[1]),
  '0131': def('0131', 'Distance since DTCs cleared', 'km', 2, (d) => d[0] * 256 + d[1]),
  '012F': def('012F', 'Fuel level', '%', 1, (d) => (d[0] * 100) / 255),
  '0133': def('0133', 'Barometric pressure', 'kPa', 1, (d) => d[0]),
  '0142': def('0142', 'Module voltage', 'V', 2, (d) => (d[0] * 256 + d[1]) / 1000),
  '0146': def('0146', 'Ambient air temp', '°C', 1, (d) => d[0] - 40),
  '015C': def('015C', 'Engine oil temp', '°C', 1, (d) => d[0] - 40),
  '015E': def('015E', 'Engine fuel rate', 'L/h', 2, (d) => (d[0] * 256 + d[1]) / 20),
};

/** Decode a PID's data bytes to a number, or null if unknown/short. */
export function decodePid(pid: string, data: number[]): number | null {
  const desc = PID_REGISTRY[pid.toUpperCase()];
  if (!desc) return null;
  if (data.length < desc.bytes) return null;
  return desc.decode(data);
}

/**
 * True for the "supported PIDs" range-marker pseudo-PIDs (0x20/0x40/0x60), which signal that the
 * next bitmap range exists but are not real live parameters.
 */
export function isMarkerPid(pid: string): boolean {
  const num = parseInt(pid.slice(2), 16);
  return Number.isFinite(num) && num !== 0 && num % 0x20 === 0;
}
