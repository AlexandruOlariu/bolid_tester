/** Adaptation-channel service: read / write-with-backup-and-verify one numeric channel.
 *  SAFETY mirrors coding (docs/features/coding.md): unlock gate upstream, mandatory backup via
 *  codeModule, verify re-read, restore path. Channels demanding SecurityAccess stay read-only
 *  unless the profile supplies a real seed/key algorithm — none ship by default. */

import { DiagnosticSession, codeModule, decodeAdaptationRaw } from '@/shared/obd-core';
import type { AdaptationChannel } from '@/shared/vehicles';

export async function readChannel(
  session: DiagnosticSession,
  ch: AdaptationChannel,
): Promise<number[] | null> {
  try {
    await session.setHeader(ch.reqHeader);
    await session.setRxFilter(ch.rxFilter);
    return await session.readExtended(ch.did);
  } finally {
    await session.resetAddressing();
  }
}

export interface WriteOutcome {
  ok: boolean;
  backup?: number[];
  message: string;
}

export async function writeChannel(
  session: DiagnosticSession,
  ch: AdaptationChannel,
  newRaw: number[],
): Promise<WriteOutcome> {
  if (ch.security) {
    return {
      ok: false,
      message:
        'This channel requires SecurityAccess and no seed/key algorithm is available for this ' +
        'module — read-only.',
    };
  }
  // Enforce the channel's display bounds HERE, not only in the UI — every write path (including
  // future ones) must pass through the same guard.
  const outOfBounds = checkBounds(ch, newRaw);
  if (outOfBounds) return { ok: false, message: outOfBounds };
  try {
    await session.setHeader(ch.reqHeader);
    await session.setRxFilter(ch.rxFilter);
    const res = await codeModule((cmd) => session.send(cmd), { did: ch.did, newData: newRaw });
    return {
      ok: res.verified,
      backup: res.backup,
      message: res.verified ? 'Write verified.' : 'Write sent but verification failed — check the value.',
    };
  } catch (e) {
    return { ok: false, message: `Failed: ${(e as Error).message}` };
  } finally {
    await session.resetAddressing();
  }
}

/** Non-null = human-readable refusal when the raw bytes decode outside the channel's min/max. */
export function checkBounds(ch: AdaptationChannel, raw: number[]): string | null {
  if (ch.min === undefined && ch.max === undefined) return null;
  const value = decodeAdaptationRaw(raw, {
    byteCount: ch.byteCount,
    scale: ch.scale,
    offset: ch.offset,
  });
  if (ch.min !== undefined && value < ch.min) {
    return `Value ${value}${ch.unit ? ' ' + ch.unit : ''} is below the channel minimum (${ch.min}).`;
  }
  if (ch.max !== undefined && value > ch.max) {
    return `Value ${value}${ch.unit ? ' ' + ch.unit : ''} is above the channel maximum (${ch.max}).`;
  }
  return null;
}
