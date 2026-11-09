import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { isCan, isKLine, decodeAdaptationRaw, encodeAdaptationValue } from '@/shared/obd-core';
import { findLabelPack, adaptationLabel } from '@/shared/labels';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { logError } from '@/shared/state/errorLogStore';
import type { AdaptationChannel, LoginCodeEntry } from '@/shared/vehicles';
import { useActiveProfile } from '@/features/vehicle-select/api/activeProfile';
import {
  isKwpChannel,
  readChannel,
  writeChannel,
  type WriteOutcome,
} from '../api/adaptationService';
import {
  forgetLoginCode,
  loginFor,
  preVinCodeBook,
  rememberLoginCode,
  userCodeBook,
} from '../api/codeBook';
import { useAdaptationsStore } from '../model/adaptationsStore';
import { useLoginBookStore } from '../model/loginBookStore';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';

/** A KWP login for one write: the code, the workshop code, and whether to remember it. */
export interface LoginInput {
  code: number;
  wsc?: number;
  /** "Remember for this car" — stored only after the module accepted the login (`6B`). */
  remember?: boolean;
}

/** What the code book knows for a login channel. `remembered` = this car's own entry (the write
 *  skips the sheet); otherwise `entry` only pre-fills the sheet — a code remembered for this
 *  vehicle type before the VIN was known (`origin: 'pre-vin'`), or one the profile documents
 *  (`'profile'`). */
export interface ChannelLogin {
  entry: LoginCodeEntry | null;
  remembered: boolean;
  origin: 'remembered' | 'pre-vin' | 'profile' | null;
}

/** KWP module headers whose diagnostic session is already open, for one link (`session`). */
export interface KwpSessionCache {
  session: unknown;
  headers: Set<string>;
}

export const newKwpSessionCache = (): KwpSessionCache => ({ session: null, headers: new Set() });

/** One cache per screen session: `AdaptationsScreen` provides it, so every `ChannelRow`'s hook
 *  shares it (two channels on one KWP header send a single `10 xx`). A hook outside the provider
 *  keeps its own. */
export const KwpSessionCacheContext = createContext<KwpSessionCache | null>(null);

/** The cache's header set for `session`, emptied when the link changed. */
function openHeaders(cache: KwpSessionCache, session: unknown): Set<string> {
  if (cache.session !== session) {
    cache.session = session;
    cache.headers = new Set();
  }
  return cache.headers;
}

/** VCDS-style adaptation channels: browse, read, edit within bounds, write with backup+verify,
 *  restore. Unlock-gated like coding. UDS channels need a CAN link, KWP channels a K-line link;
 *  KWP channels with `login` take a code from the code book or the login sheet (plan 22). */
export function useAdaptations() {
  const session = useSessionStore((s) => s.session);
  const vin = useSessionStore((s) => s.info?.vin ?? null);
  const profile = useActiveProfile();
  const store = useAdaptationsStore();
  const garage = useGarageStore((s) => s.vehicles);
  const book = useLoginBookStore((s) => s.byVehicle);
  // Best-effort label enrichment from the live-scanned part number (module-scan results), so the
  // same channel shows its label-pack description when the pack matches the real module.
  const scanResults = useModuleScanStore((s) => s.results);
  // KWP: module headers whose diagnostic session this screen session already opened (reads skip
  // the `10 xx`), shared by every row through the screen's provider; emptied when the link
  // changes. Writes always re-enter the session.
  const sharedKwpCache = useContext(KwpSessionCacheContext);
  const ownKwpCache = useRef<KwpSessionCache | null>(null);
  const kwpCache = sharedKwpCache ?? (ownKwpCache.current ??= newKwpSessionCache());

  const proto = session?.currentProtocol ?? 'UNKNOWN';
  const declared = useMemo(() => profile.adaptations ?? [], [profile]);
  // UDS channels ride on CAN, KWP channels on K-line; the rest are not reachable on this link.
  const channels = useMemo(
    () => declared.filter((ch) => (isKwpChannel(ch) ? isKLine(proto) : isCan(proto))),
    [declared, proto],
  );
  const available = !!session && channels.length > 0;

  const packFor = useCallback(
    (ch: AdaptationChannel) => {
      const scanned = scanResults.find((r) => r.module.reqHeader === ch.reqHeader);
      return findLabelPack(scanned?.ident?.partNumber);
    },
    [scanResults],
  );

  const describe = useCallback(
    (ch: AdaptationChannel) => adaptationLabel(packFor(ch), ch.did)?.description ?? null,
    [packFor],
  );

  const loginInfo = useCallback(
    (ch: AdaptationChannel): ChannelLogin | null => {
      if (!ch.login) return null;
      const bare = { ...profile, loginCodes: undefined };
      const own = loginFor(bare, userCodeBook(profile, vin, garage, book), ch);
      if (own) return { entry: own, remembered: true, origin: 'remembered' };
      const preVin = loginFor(bare, preVinCodeBook(profile, vin, book), ch);
      if (preVin) return { entry: preVin, remembered: false, origin: 'pre-vin' };
      const documented = loginFor(profile, null, ch);
      return { entry: documented, remembered: false, origin: documented ? 'profile' : null };
    },
    [profile, vin, garage, book],
  );

  const forgetLogin = useCallback(
    (ch: AdaptationChannel) => forgetLoginCode(profile, vin, ch),
    [profile, vin],
  );

  const read = useCallback(
    async (ch: AdaptationChannel) => {
      if (!session) return null;
      store.setRunning(true);
      const open = openHeaders(kwpCache, session);
      try {
        const kwp = isKwpChannel(ch);
        const raw = await readChannel(session, ch, {
          sessionOpen: kwp && open.has(ch.reqHeader),
        });
        if (kwp) open.add(ch.reqHeader);
        if (raw) store.setValue(ch.did, raw);
        return raw;
      } catch (e) {
        open.delete(ch.reqHeader);
        logError({ source: 'adaptations/read', error: e, context: { did: ch.did } });
        store.setLastResult(`Read failed: ${(e as Error).message}`);
        return null;
      } finally {
        store.setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; session and the cache are the reactive inputs
    [session, kwpCache],
  );

  /** Run one guarded write and settle the code book: a code the user asked to remember is stored
   *  only once the module accepted the login (`loginAccepted`, the `6B`) — never after a refusal,
   *  a dead link or a lockout before or during the login; a code typed for one write is never
   *  stored. A remembered code the module rejects (NRC 0x35) is forgotten, so the next write asks
   *  again instead of re-sending it. */
  const runWrite = useCallback(
    async (ch: AdaptationChannel, raw: number[], login?: LoginInput): Promise<WriteOutcome> => {
      if (!session) return { ok: false, message: 'Not connected.' };
      const res = await writeChannel(
        session,
        ch,
        raw,
        login ? { login: { code: login.code, wsc: login.wsc } } : {},
      );
      if (login?.remember && res.loginAccepted) {
        rememberLoginCode(profile, vin, ch, login);
      } else if (login && res.loginRejected) {
        const own = loginFor({ ...profile, loginCodes: undefined }, userCodeBook(profile, vin), ch);
        if (own && own.code === login.code) forgetLoginCode(profile, vin, ch);
      }
      return res;
    },
    [session, profile, vin],
  );

  const write = useCallback(
    async (
      ch: AdaptationChannel,
      displayValue: number,
      login?: LoginInput,
    ): Promise<WriteOutcome> => {
      const refused = (message: string): WriteOutcome => {
        store.setLastResult(message);
        return { ok: false, message };
      };
      if (!session) return refused('Not connected.');
      if (!store.unlocked) return refused('Locked — enable the adaptations unlock first.');
      if (ch.min !== undefined && displayValue < ch.min) {
        return refused(`Out of bounds: minimum is ${ch.min}${ch.unit ?? ''}.`);
      }
      if (ch.max !== undefined && displayValue > ch.max) {
        return refused(`Out of bounds: maximum is ${ch.max}${ch.unit ?? ''}.`);
      }
      const newRaw = encodeAdaptationValue(displayValue, ch);
      store.setRunning(true);
      try {
        const res = await runWrite(ch, newRaw, login);
        if (res.backup) {
          store.addBackup({ did: ch.did, module: ch.module, raw: res.backup, at: Date.now() });
        }
        if (res.ok) store.setValue(ch.did, newRaw);
        else
          logError({
            source: 'adaptations/write',
            error: res.message,
            severity: 'warning',
            // Never the login code: it stays out of the error log.
            context: {
              did: ch.did,
              newRaw: newRaw.map((b) => b.toString(16).padStart(2, '0')).join(''),
            },
          });
        store.setLastResult(res.message);
        return res;
      } finally {
        store.setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; reactive inputs (session, unlock, runWrite) are listed
    [session, store.unlocked, runWrite],
  );

  const restore = useCallback(
    async (ch: AdaptationChannel, raw: number[], login?: LoginInput): Promise<WriteOutcome> => {
      if (!session) return { ok: false, message: 'Not connected.' };
      store.setRunning(true);
      try {
        const res = await runWrite(ch, raw, login);
        if (res.ok) store.setValue(ch.did, raw);
        store.setLastResult(res.ok ? 'Restored.' : res.message);
        return res;
      } finally {
        store.setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store methods are stable zustand actions; session and runWrite are the reactive inputs
    [session, runWrite],
  );

  const display = useCallback(
    (ch: AdaptationChannel, raw: number[] | undefined) =>
      raw ? decodeAdaptationRaw(raw, ch) : null,
    [],
  );

  return {
    available,
    channels,
    declaredCount: declared.length,
    kline: isKLine(proto),
    describe,
    loginInfo,
    forgetLogin,
    read,
    write,
    restore,
    display,
  };
}
