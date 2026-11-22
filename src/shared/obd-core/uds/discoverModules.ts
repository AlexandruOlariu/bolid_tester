/** Module address discovery (plan 25): probe each candidate CAN id pair with `22 F187` (part
 *  number) and read the standard ident of every module that answers — the one-tap way to learn a
 *  car's real UDS module map. Read-only: only `22` reads are sent. Addressing is restored after
 *  EVERY candidate (`resetAddressing()` in `finally`), so standard OBD2 reads keep working even if
 *  the scan is interrupted. 11-bit CAN only: every candidate is an 11-bit id pair, and on 29-bit
 *  CAN / J1939 there is no functional header to restore `ATSH` to, so the scan refuses to start.
 *  Candidates that share one id pair (VAG 08 / 46 on 746/7B0) are probed ONCE; the ident picks
 *  the address (`pickCandidateByIdent`) and the others ride along as `alternatives`. */

import type { DiagnosticSession } from '../session/DiagnosticSession';
import { isModuleUnreachableError } from '../coding/udsCoding';
import { readModuleIdent, type ModuleIdent } from './udsModule';
import { isCan11 } from '../obd/protocols';
import { groupCandidatesByPair, pickCandidateByIdent, type UdsHeaderCandidate } from './vagHeaders';

export interface DiscoveredModule {
  /** The candidate this result is reported as — for a shared id pair, the one the ident points to. */
  candidate: UdsHeaderCandidate;
  /** Other candidates on the SAME id pair (one physical module; the user may pick one of these
   *  instead when the ident says so). Absent when the pair is unique. */
  alternatives?: UdsHeaderCandidate[];
  /** The module's ident when it answered (may have no fields if it refused every ident DID). */
  ident: ModuleIdent | null;
  /** 'answered' any reply (a negative `7F 22 xx` still proves a module listens there); 'silent'
   *  NO DATA / timeout; 'error' anything else (the message is in `reason`). */
  state: 'answered' | 'silent' | 'error';
  reason?: string;
  /** Time spent on this candidate. */
  ms: number;
}

/** Default per-command timeout while probing: a silent candidate is the common case, so a full
 *  4 s timeout each would make a 15-candidate scan take a minute. The ELM327 itself answers
 *  NO DATA after its own ATST window, well inside this. */
export const DISCOVERY_TIMEOUT_MS = 1000;

export async function discoverUdsModules(
  session: DiagnosticSession,
  candidates: UdsHeaderCandidate[],
  opts: { timeoutMs?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<DiscoveredModule[]> {
  if (!isCan11(session.currentProtocol)) {
    throw new Error(
      'Module discovery needs 11-bit CAN: on this protocol the default addressing could not be ' +
        'restored afterwards.',
    );
  }
  const timeoutMs = opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const out: DiscoveredModule[] = [];
  const send = (cmd: string) => session.send(cmd);
  const groups = groupCandidatesByPair(candidates);
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const candidate = group[0];
    const t0 = Date.now();
    let found: Omit<DiscoveredModule, 'ms'>;
    try {
      found = await session.withCommandTimeout(
        timeoutMs,
        async (): Promise<Omit<DiscoveredModule, 'ms'>> => {
          await session.setHeader(candidate.reqHeader);
          await session.setRxFilter(candidate.rxFilter);
          const probe = await send('22F187');
          if (!probe || probe.length === 0) return { candidate, ident: null, state: 'silent' };
          const ident = await readModuleIdent(send);
          return { candidate, ident, state: 'answered' };
        },
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      found = isModuleUnreachableError(reason)
        ? { candidate, ident: null, state: 'silent' }
        : { candidate, ident: null, state: 'error', reason };
    } finally {
      await session.resetAddressing();
    }
    if (group.length > 1) {
      const chosen = pickCandidateByIdent(group, found.ident);
      found = { ...found, candidate: chosen, alternatives: group.filter((c) => c !== chosen) };
    }
    out.push({ ...found, ms: Date.now() - t0 });
    opts.onProgress?.(i + 1, groups.length);
  }
  return out;
}
