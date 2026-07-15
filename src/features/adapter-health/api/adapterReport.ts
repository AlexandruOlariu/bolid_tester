/** Pure text formatter for an adapter health run — the shareable "is my clone junk?" artifact.
 *  No I/O; kept separate from the React layer so it can be unit-tested and reused. */

import type { AdapterHealthResult } from './gradeAdapter';

export interface AdapterReportInput {
  version: string;
  voltage: number | null;
  protocol: string;
  latenciesMs: number[];
  attempts: number;
  result: AdapterHealthResult;
  ranAt: number;
}

const GRADE_LABEL: Record<AdapterHealthResult['grade'], string> = {
  good: 'GOOD — genuine-quality behaviour',
  ok: 'OK — usable, with caveats',
  poor: 'POOR — slow or unreliable',
};

/** Render a plain-text report suitable for pasting into a support thread or the OS share sheet. */
export function formatAdapterReport(input: AdapterReportInput): string {
  const { result } = input;
  const lines: string[] = [];
  lines.push('Adapter health check');
  lines.push('====================');
  lines.push(`Grade:     ${GRADE_LABEL[result.grade]}`);
  lines.push(`Firmware:  ${input.version || '(none reported)'}`);
  lines.push(`Voltage:   ${input.voltage == null ? '(unreadable)' : `${input.voltage.toFixed(1)} V`}`);
  lines.push(`Protocol:  ${input.protocol || 'Unknown'}`);
  if (result.latency) {
    const { min, median, max, count } = result.latency;
    lines.push(
      `0100 latency: min ${Math.round(min)} / median ${Math.round(median)} / max ${Math.round(max)} ms` +
        ` (${count}/${input.attempts} answered)`,
    );
  } else {
    lines.push(`0100 latency: no responses (0/${input.attempts} answered)`);
  }
  if (result.cloneSuspected) lines.push('Clone suspected: yes');
  if (result.notes.length) {
    lines.push('');
    lines.push('Notes:');
    for (const n of result.notes) lines.push(`- ${n}`);
  }
  lines.push('');
  lines.push(`Generated ${new Date(input.ranAt).toISOString()} by Bolid Tester.`);
  return lines.join('\n');
}
