/** The adapter health check's command sequence, independent of React: identity (`ATI` / `ATRV` /
 *  `ATDPN`) then a timed `0100` burst, graded by `gradeAdapter`. `useAdapterHealth` drives it with
 *  the live session's client; tests drive it against the simulator (plan 29). */
import { PROTOCOL_LABELS, type ProtocolId } from '@/shared/obd-core';
import { gradeAdapter } from './gradeAdapter';
import type { AdapterReportInput } from './adapterReport';

/** The slice of `Elm327Client` the check uses. */
export interface HealthCheckClient {
  version(): Promise<string>;
  voltage(): Promise<number | null>;
  protocolNumber(): Promise<ProtocolId>;
  command(cmd: string): Promise<unknown>;
}

export interface HealthCheckOptions {
  /** How many timed `0100` round trips (default 10). */
  burst?: number;
  /** Progress label for each step. */
  onPhase?: (phase: string) => void;
  /** Stop the burst early (e.g. the screen unmounted). */
  shouldStop?: () => boolean;
  /** Clock (ms); injectable for tests. */
  now?: () => number;
}

export const DEFAULT_BURST = 10;

/** Run the whole check and return the finished report. Identity reads that fail degrade to
 *  "" / null / Unknown; a failed `0100` counts as an attempt without a latency. */
export async function runHealthCheck(
  client: HealthCheckClient,
  opts: HealthCheckOptions = {},
): Promise<AdapterReportInput> {
  const burst = opts.burst ?? DEFAULT_BURST;
  const phase = opts.onPhase ?? (() => undefined);
  const now = opts.now ?? Date.now;

  phase('Reading firmware (ATI)…');
  const version = await client.version().catch(() => '');

  phase('Reading voltage (ATRV)…');
  const voltage = await client.voltage().catch(() => null);

  phase('Detecting protocol (ATDPN)…');
  const protocolId = await client.protocolNumber().catch(() => 'UNKNOWN' as const);
  const protocol = PROTOCOL_LABELS[protocolId] ?? 'Unknown';

  const latenciesMs: number[] = [];
  let attempts = 0;
  for (let i = 0; i < burst; i++) {
    if (opts.shouldStop?.()) break;
    phase(`Timing 0100 (${i + 1}/${burst})…`);
    attempts++;
    const t0 = now();
    try {
      await client.command('0100');
      latenciesMs.push(now() - t0);
    } catch {
      // A timed-out / errored command doesn't contribute a latency but still counts as an attempt.
    }
  }

  const result = gradeAdapter({ version, voltage, protocol, latenciesMs });
  return { version, voltage, protocol, latenciesMs, attempts, result, ranAt: now() };
}
