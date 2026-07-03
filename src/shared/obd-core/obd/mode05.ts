/** Mode 05 — O2 sensor monitoring test results (non-CAN protocols only; CAN cars expose the same
 *  through Mode 06). Petrol/K-line territory: TIDs 01/02 are the rich→lean / lean→rich thresholds
 *  (0.005 V/bit); other TIDs are reported raw. */

export interface Mode05Result {
  tid: string;
  sensor: string;
  name: string;
  values: number[]; // raw data bytes
  /** Volts for the threshold TIDs (01/02), null otherwise. */
  volts: number | null;
}

const TID_NAMES: Record<string, string> = {
  '01': 'Rich→lean sensor threshold',
  '02': 'Lean→rich sensor threshold',
  '03': 'Low sensor voltage (switch time)',
  '04': 'High sensor voltage (switch time)',
  '05': 'Rich→lean switch time',
  '06': 'Lean→rich switch time',
};

/** Parse a positive Mode 05 response: [0x45, tid, sensor, ...data]. */
export function decodeMode05(bytes: number[]): Mode05Result | null {
  if (bytes.length < 4 || bytes[0] !== 0x45) return null;
  const tid = bytes[1].toString(16).padStart(2, '0').toUpperCase();
  const sensor = bytes[2].toString(16).padStart(2, '0').toUpperCase();
  const values = bytes.slice(3);
  const isThreshold = tid === '01' || tid === '02';
  return {
    tid,
    sensor,
    name: TID_NAMES[tid] ?? `TID ${tid}`,
    values,
    volts: isThreshold && values.length ? Math.round(values[0] * 5) / 1000 : null,
  };
}
