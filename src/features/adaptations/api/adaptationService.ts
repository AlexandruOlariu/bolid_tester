/** Adaptation-channel service: read / write-with-backup-and-verify one numeric channel.
 *  SAFETY mirrors coding (docs/features/coding.md): unlock gate upstream, mandatory backup, verify
 *  re-read, restore path. Channels demanding SecurityAccess stay read-only unless the profile
 *  supplies a real seed/key algorithm — none ship by default.
 *
 *  Two transports (plan 22): UDS channels (the default) read `22` / write `2E` over CAN through
 *  `codeModule`; KWP channels (`transport: 'kwp'`, K-line KWP2000) enter the diagnostic session
 *  (default 0x85), log in with `2B` when the channel needs it, then read `21` / write `3B`. A
 *  login channel without a code is refused before any bus traffic. */

import {
  DiagnosticSession,
  adaptationBoundsError,
  codeModule,
  describeLoginFailure,
  enterSession,
  isCan,
  kwpLogin,
  kwpReadLocal,
  kwpWriteLocal,
  UdsError,
  type UdsSend,
} from '@/shared/obd-core';
import type { AdaptationChannel } from '@/shared/vehicles';

/** KWP2000 session a K-line adaptation channel runs in unless it says otherwise. */
export const DEFAULT_KWP_SESSION = 0x85;

export const isKwpChannel = (ch: AdaptationChannel): boolean => ch.transport === 'kwp';

/** Address the channel's module: header, and the CAN receive filter for UDS channels (K-line has
 *  none; `resetAddressing()` restores the functional header after). */
async function address(session: DiagnosticSession, ch: AdaptationChannel): Promise<void> {
  await session.setHeader(ch.reqHeader);
  if (!isKwpChannel(ch) || (ch.rxFilter && isCan(session.currentProtocol))) {
    await session.setRxFilter(ch.rxFilter);
  }
}

export interface ReadChannelOptions {
  /** KWP: the module's diagnostic session is already open (the hook caches it per screen
   *  session), so the `10 xx` is skipped. */
  sessionOpen?: boolean;
}

export async function readChannel(
  session: DiagnosticSession,
  ch: AdaptationChannel,
  opts: ReadChannelOptions = {},
): Promise<number[] | null> {
  try {
    await address(session, ch);
    if (isKwpChannel(ch)) {
      const send: UdsSend = (cmd) => session.send(cmd);
      if (!opts.sessionOpen) await enterSession(send, ch.session ?? DEFAULT_KWP_SESSION);
      return await kwpReadLocal(send, ch.did);
    }
    return await session.readExtended(ch.did);
  } finally {
    await session.resetAddressing();
  }
}

export interface WriteOutcome {
  ok: boolean;
  backup?: number[];
  message: string;
  /** KWP: the module rejected the login code (NRC 0x35) — nothing was written. */
  loginRejected?: boolean;
  /** KWP: the channel needs a login and none was supplied — nothing was sent. */
  loginRequired?: boolean;
  /** KWP: the module answered the `2B` login positively (`6B`). Set even when a later step
   *  fails; the only outcome on which a code may be remembered. */
  loginAccepted?: boolean;
}

export interface WriteChannelOptions {
  /** KWP login for channels with `login: true`. Used for this write only — never stored here. */
  login?: { code: number; wsc?: number };
}

export async function writeChannel(
  session: DiagnosticSession,
  ch: AdaptationChannel,
  newRaw: number[],
  opts: WriteChannelOptions = {},
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
  if (isKwpChannel(ch)) return writeKwpChannel(session, ch, newRaw, opts);
  try {
    await address(session, ch);
    const res = await codeModule((cmd) => session.send(cmd), { did: ch.did, newData: newRaw });
    return verifiedOutcome(res.verified, res.backup);
  } catch (e) {
    return { ok: false, message: `Failed: ${(e as Error).message}` };
  } finally {
    await session.resetAddressing();
  }
}

function verifiedOutcome(verified: boolean, backup: number[]): WriteOutcome {
  return {
    ok: verified,
    backup,
    message: verified ? 'Write verified.' : 'Write sent but verification failed — check the value.',
  };
}

/** KWP: session → login (when the channel needs one) → backup (`21`) → write (`3B`) → re-read →
 *  verify. The session is always (re)entered, so a module that dropped its session — and with it
 *  the login — is logged in again. */
async function writeKwpChannel(
  session: DiagnosticSession,
  ch: AdaptationChannel,
  newRaw: number[],
  opts: WriteChannelOptions,
): Promise<WriteOutcome> {
  if (ch.login && !opts.login) {
    return {
      ok: false,
      loginRequired: true,
      message: 'Login required — enter the login code for this module first. Nothing was sent.',
    };
  }
  let backup: number[] | undefined;
  let loginAccepted = false;
  try {
    await address(session, ch);
    const send: UdsSend = (cmd) => session.send(cmd);
    await enterSession(send, ch.session ?? DEFAULT_KWP_SESSION);
    if (ch.login && opts.login) {
      await kwpLogin(send, opts.login.code, opts.login.wsc ?? 0);
      loginAccepted = true;
    }
    backup = await kwpReadLocal(send, ch.did);
    await kwpWriteLocal(send, ch.did, newRaw);
    const after = await kwpReadLocal(send, ch.did);
    const verified = after.length === newRaw.length && after.every((b, i) => b === newRaw[i]);
    return { ...verifiedOutcome(verified, backup), ...(loginAccepted ? { loginAccepted } : {}) };
  } catch (e) {
    const described = describeLoginFailure(e);
    return {
      ok: false,
      ...(backup ? { backup } : {}),
      ...(loginAccepted ? { loginAccepted } : {}),
      ...(e instanceof UdsError && e.nrc === 0x35 ? { loginRejected: true } : {}),
      message: described ?? `Failed: ${(e as Error).message}`,
    };
  } finally {
    await session.resetAddressing();
  }
}

/** Non-null = human-readable refusal when the raw bytes are the wrong width or decode outside the
 *  channel's min/max. A thin wrapper over the core guard (`adaptationBoundsError`) so every write
 *  path — this screen and the backup restore — shares one implementation. */
export function checkBounds(ch: AdaptationChannel, raw: number[]): string | null {
  return adaptationBoundsError(ch, raw);
}
