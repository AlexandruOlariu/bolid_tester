/** A virtual ELM327 that implements Transport, so the whole app/test-suite runs with no hardware.
 *  See docs/simulator.md. */

import { Transport, TransportStatus } from './Transport';
import { ProtocolId, elmNumberFromProtocol, functionalHeader, isCan } from '../obd/protocols';
import { encodeSupportedPids } from '../obd/supportedPids';
import { encodeDtc } from '../obd/dtc';
import { asciiToBytes, bytesToString, stringToBytes } from '../../lib/bytes';
import { byteToHex, toHex, parseHexBytes } from '../../lib/hex';

export interface SimScenario {
  protocol: ProtocolId;
  supportedPids: string[]; // '0104' etc — the PIDs this ECU reports
  vin?: string;
  vinSupported?: boolean; // default true if vin set
  /** Calibration ID reported via Mode 09 PID 04 (0904); omitted -> "NO DATA". */
  calibrationId?: string;
  storedDtcs?: string[];
  pendingDtcs?: string[];
  permanentDtcs?: string[];
  /** Engine Mode 22 DIDs: '1701' -> response data bytes. Answered with default addressing or on the
   *  engine header (7E0) only — not on another module's header (CAN). */
  extendedDids?: Record<string, number[]>;
  /** Mode 06 monitor responses: mid -> full response bytes (including the 0x46 service byte). */
  mode06?: Record<string, number[]>;
  /** Module-scoped UDS 22 reads, keyed by the ATSH request header then DID -> data bytes. */
  moduleDids?: Record<string, Record<string, number[]>>;
  /** Codeable modules: ATSH header -> DID -> mutable coding bytes (read via 22, written via 2E). */
  coding?: Record<string, Record<string, number[]>>;
  /** Per-module UDS DTC stores for the module scan: ATSH header -> 3-byte DTCs + status.
   *  Served via 0x19 0x02, cleared via 0x14. */
  moduleDtcs?: Record<string, { bytes: [number, number, number]; status: number }[]>;
  /** Per-module ident DIDs (ASCII), served via 22 F1xx: ATSH header -> DID -> text. */
  moduleIdent?: Record<string, Record<string, string>>;
  /** IUPR (Mode 09 08/0B) payload after the 0x49 0x08/0x0B echo: [itemCount, ...2-byte items]. */
  iuprSpark?: number[];
  iuprCompression?: number[];
  /** Mode 05 responses keyed by tid+sensor (e.g. '0101') -> full response bytes (0x45 …). */
  mode05?: Record<string, number[]>;
  /** Raw monitor lines the simulator streams cyclically during ATMA (CAN sniffer). */
  monitorFrames?: string[];
  /** Additional ECUs that answer FUNCTIONAL (broadcast, headers-off) requests on their OWN line,
   *  exactly as a real multi-ECU car does (e.g. engine + transmission). Only the requests a
   *  secondary emissions module actually answers are modelled: the supported-PID bitmaps
   *  (0100/0120/0140/0160) and stored/pending DTCs (Mode 03 / 07). Physically-addressed (ATSH) work
   *  is unaffected — that targets a single module. Undefined ⇒ the classic single-ECU simulator,
   *  unchanged. See docs/simulator.md. */
  secondaryEcus?: {
    supportedPids: string[];
    storedDtcs?: string[];
    pendingDtcs?: string[];
  }[];
  /** KWP2000 local identifiers (plan 22), per ATSH header (or '*' for the functional / single
   *  K-line ECU): lid -> mutable bytes. Read via `21 <lid>`, written via `3B <lid> <data>`. */
  kwpLocals?: Record<string, Record<string, number[]>>;
  /** Login codes the simulated KWP module accepts (`2B`): header | '*' -> { code, wsc? }. A `wsc`
   *  left out accepts any workshop code. */
  kwpLogins?: Record<string, { code: number; wsc?: number }>;
  /** Local identifiers whose `3B` write answers `7F 3B 33` until a matching `2B` login succeeded
   *  in the current diagnostic session (a `10 xx` restarts the session and drops the login). */
  kwpLoginRequired?: string[];
  /** Per-header SecurityAccess model (plan 23), keyed by the ATSH request header (or '*' for
   *  default addressing). When present for the addressed header: `27 <level>` answers the `seed`
   *  (all zeros once unlocked), `27 <level+1> <key>` is compared with `key` — a match unlocks, a
   *  mismatch answers `7F 27 35` and the third failure `7F 27 36` (after which every `27` on that
   *  header answers `7F 27 36`), a key without a seed request answers `7F 27 24` — and the
   *  `protects` services answer `7F <svc> 33` until unlocked. A `10 xx` re-locks. `seed` / `key`
   *  are test vectors, not a routine: the simulator never derives a key. Absent ⇒ the classic
   *  `27` stub (zero seed = "already unlocked"), so default scenarios are unchanged. */
  security?: Record<
    string,
    { level: number; seed: number[]; key: number[]; protects: ('2E' | '31' | '2F' | '3B')[] }
  >;
  latencyMs?: number;
  emitSearching?: boolean;
  /** Adapter auto-sleep: after this idle gap (ms since the last write or reply) the next non-empty command is
   *  swallowed (the byte only wakes the chip); a bare `\r` is answered with `\r>`. Mirrors ELM327
   *  low-power behaviour. While set, a bare `\r` to an awake adapter also gets `\r>` (a real
   *  ELM327 would repeat the last command; the client only sends it when that is harmless). */
  sleepAfterIdleMs?: number;
}

/** Realistic raw data bytes per PID, chosen to decode to plausible idle values. */
const SIM_PID_BYTES: Record<string, number[]> = {
  '0104': [0x40],
  '0105': [0x7d],
  '0106': [0x80],
  '0107': [0x80],
  '010a': [0x64],
  '010b': [0x64],
  '010c': [0x0c, 0xd0],
  '010d': [0x00],
  '010e': [0x94],
  '010f': [0x46],
  '0110': [0x01, 0x5e],
  '0111': [0x24],
  '011f': [0x00, 0x78],
  '0121': [0x00, 0x00],
  '0122': [0x9e, 0x40],
  '0123': [0x10, 0x68],
  '0131': [0x04, 0xd2],
  '012f': [0x80],
  '0133': [0x64],
  '0142': [0x36, 0xb0],
  '0144': [0x80, 0x00],
  '0146': [0x3e],
  '015c': [0x82],
  '015e': [0x00, 0x1e],
};

/** ISO 15765-4 physical request id of the engine ECU (11-bit CAN). */
const ENGINE_REQ_HEADER = '7E0';

export class MockTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private listeners = new Set<(b: Uint8Array) => void>();
  private statusListeners = new Set<(s: TransportStatus) => void>();
  private searched = false;
  private header: string | null = null; // current ATSH target (module addressing)
  /** Current ATCRA receive filter — modelled so a stale filter breaks reads like on a real
   *  adapter (regression guard for the restore-addressing paths). */
  private craFilter: string | null = null;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private monitorIdx = 0;
  /** Last adapter activity (a write in, or a reply out) for the `sleepAfterIdleMs` low-power model. */
  private lastActivityAt = Date.now();
  /** `dropResponses` budget: the next N matching commands get no reply at all. */
  private dropBudget = 0;
  private dropIncludesAt = false;
  /** KWP login state (plan 22): the headers (or '*') that passed a `2B` login in their current
   *  diagnostic session. */
  private loggedIn = new Set<string>();
  /** SecurityAccess state (plan 23), per header key: unlocked modules, a pending seed request,
   *  and failed key attempts (never reset by a session change, like a real module's counter). */
  private secUnlocked = new Set<string>();
  private secSeedSent = new Set<string>();
  private secFailures = new Map<string, number>();

  constructor(public scenario: SimScenario) {}

  /** Move to a new link status, notifying subscribers only on an actual transition. */
  private setStatus(status: TransportStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of [...this.statusListeners]) l(status);
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    this.lastActivityAt = Date.now();
    this.setStatus('connected');
  }

  /** Test/sim hook: the next `n` non-AT commands get **no reply at all** (not even a prompt), so the
   *  client times out — drives the timeout / drain / diagnostics paths. With `includeAt`, AT commands
   *  count too (e.g. "no reply to ATZ" = an unpowered or asleep adapter). Bare `\r` is never
   *  dropped. Calling it again replaces the previous budget. */
  dropResponses(n: number, opts: { includeAt?: boolean } = {}): void {
    this.dropBudget = Math.max(0, Math.floor(n));
    this.dropIncludesAt = opts.includeAt ?? false;
  }

  /** Send adapter output to the listeners after the scenario's latency. */
  private emit(text: string): void {
    const out = stringToBytes(text);
    setTimeout(() => this.deliver(out), this.scenario.latencyMs ?? 0);
  }

  /** Hand bytes to every listener now; replying counts as adapter activity (keeps it awake). */
  private deliver(out: Uint8Array): void {
    this.lastActivityAt = Date.now();
    for (const l of [...this.listeners]) l(out);
  }

  async disconnect(): Promise<void> {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.setStatus('disconnected');
  }

  /** Test/sim hook: simulate an unsolicited link drop (adapter pulled, out of range) so the
   *  status-event path — and the app's disconnect handling / auto-reconnect — can be exercised
   *  with no hardware. Mirrors BleTransport's `onDisconnected` emission. */
  simulateDisconnect(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.setStatus('disconnected');
  }

  onData(listener: (b: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatusChange(listener: (s: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async write(bytes: Uint8Array): Promise<void> {
    // A closed link answers nothing, like BleTransport (which throws when not connected).
    if (this.status !== 'connected') throw new Error('Simulator link is not connected');
    const cmd = bytesToString(bytes)
      .replace(/[\r\n]+$/g, '')
      .trim();
    // Any byte interrupts monitor mode (like a real ELM327), answering with a prompt.
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
      if (!cmd) {
        this.emit('\r>');
        return;
      }
    }
    // Low-power model: after the idle gap the chip is asleep — the byte that arrives only wakes it.
    const sleepMs = this.scenario.sleepAfterIdleMs;
    if (sleepMs !== undefined && sleepMs > 0) {
      const now = Date.now();
      const asleep = now - this.lastActivityAt > sleepMs;
      this.lastActivityAt = now;
      if (!cmd) {
        this.emit('\r>');
        return;
      }
      if (asleep) return; // swallowed: the command that carried the wake-up byte is lost
    } else {
      this.lastActivityAt = Date.now();
    }
    if (!cmd) return;
    if (this.dropBudget > 0 && (this.dropIncludesAt || !/^AT/i.test(cmd))) {
      this.dropBudget -= 1;
      return; // no reply at all — the client's timeout fires
    }
    // ATMA starts streaming monitor lines with NO prompt until interrupted.
    if (cmd.toUpperCase() === 'ATMA') {
      const frames = this.scenario.monitorFrames ?? [];
      this.monitorIdx = 0;
      this.monitorTimer = setInterval(() => {
        if (!frames.length) return;
        const line = frames[this.monitorIdx % frames.length];
        this.monitorIdx += 1;
        this.deliver(stringToBytes(line + '\r'));
      }, 30);
      return;
    }
    const body = this.shapeResponse(cmd, this.respond(cmd));
    this.emit(body + '\r\r' + '>');
  }

  /** Print CAN payloads > 7 bytes the way a REAL ELM327 does: a hex length line, then
   *  `N:`-prefixed ISO-TP segment lines (6 bytes on line 0, 7 after, counter wraps at 0xF).
   *  Single-line answers used to hide the app's missing de-framing — see responseParser. */
  private shapeResponse(cmd: string, body: string): string {
    if (/^AT|^ST/i.test(cmd)) return body;
    if (!isCan(this.scenario.protocol)) return body;
    if (!/^[0-9A-F]+$/i.test(body)) return body; // notices / SEARCHING-prefixed bodies
    const bytes = parseHexBytes(body);
    if (bytes.length <= 7) return body;
    const lines = [bytes.length.toString(16).toUpperCase().padStart(3, '0')];
    let i = 0;
    let seg = 0;
    while (i < bytes.length) {
      const take = seg === 0 ? 6 : 7;
      lines.push(`${(seg & 0xf).toString(16).toUpperCase()}:${toHex(bytes.slice(i, i + take))}`);
      i += take;
      seg += 1;
    }
    return lines.join('\r');
  }

  private respond(cmd: string): string {
    const c = cmd.toUpperCase();
    return c.startsWith('AT') ? this.respondAt(c) : this.respondObd(c);
  }

  private respondAt(c: string): string {
    if (c === 'ATZ' || c === 'ATI') return 'ELM327 v2.2';
    if (c === 'ATDPN') return elmNumberFromProtocol(this.scenario.protocol);
    if (c === 'ATRV') return '12.3V';
    if (c.startsWith('ATSP')) return 'OK';
    if (c.startsWith('ATSH')) {
      const hh = c.slice(4).trim();
      if (!hh) return '?'; // like a real ELM327: bare ATSH is invalid — the old header STAYS
      // Setting the protocol's functional header restores default addressing.
      this.header = hh === (functionalHeader(this.scenario.protocol) ?? '7DF') ? null : hh;
      return 'OK';
    }
    if (c.startsWith('ATCRA')) {
      const f = c.slice(5).trim();
      this.craFilter = f === '' ? null : f; // bare ATCRA clears the filter (v1.4b+)
      return 'OK';
    }
    if (
      c.startsWith('ATST') ||
      [
        'ATE0',
        'ATE1',
        'ATL0',
        'ATL1',
        'ATS0',
        'ATS1',
        'ATH0',
        'ATH1',
        'ATAT0',
        'ATAT1',
        'ATAT2',
        'ATCAF0',
        'ATCAF1',
      ].includes(c)
    ) {
      return 'OK';
    }
    return '?';
  }

  private maybeSearching(): string {
    if (this.scenario.emitSearching && !this.searched) {
      this.searched = true;
      return 'SEARCHING...\r';
    }
    return '';
  }

  private supportedNums(): number[] {
    return this.scenario.supportedPids.map((p) => parseInt(p.slice(2), 16));
  }

  private dtcResponse(service: number, codes: string[]): string {
    if (!codes.length) return byteToHex(service) + '00';
    const bytes: number[] = [];
    for (const code of codes) {
      const [a, b] = encodeDtc(code);
      bytes.push(a, b);
    }
    return byteToHex(service) + byteToHex(codes.length) + toHex(bytes);
  }

  /** Build a functional DTC response: the primary ECU's line, then one line per secondary ECU
   *  (each answers even with no codes → `43 00`), joined with `\r` so the app sees the real
   *  multi-ECU ATH0 format (one line per responding ECU). With no secondary ECUs this is a single
   *  line, identical to a classic single-ECU response. */
  private dtcLines(
    service: number,
    primary: string[],
    pick: (e: NonNullable<SimScenario['secondaryEcus']>[number]) => string[] | undefined,
  ): string {
    const lines = [this.dtcResponse(service, primary)];
    for (const ecu of this.scenario.secondaryEcus ?? []) {
      lines.push(this.dtcResponse(service, pick(ecu) ?? []));
    }
    return lines.join('\r');
  }

  /** Key of the KWP module currently addressed: the ATSH header, or '*' with default addressing. */
  private kwpKey(): string {
    return this.header ?? '*';
  }

  /** KWP2000 local-identifier store of the addressed module (header, else the '*' fallback). */
  private kwpStore(): Record<string, number[]> | undefined {
    const locals = this.scenario.kwpLocals;
    return locals?.[this.kwpKey()] ?? locals?.['*'];
  }

  /** The SecurityAccess model for the addressed module (plan 23), or undefined. */
  private securityModel(): NonNullable<SimScenario['security']>[string] | undefined {
    return this.scenario.security?.[this.kwpKey()];
  }

  /** SecurityAccess `27` and the services it protects, for a module with a `security` model.
   *  Null when the request is not one of them (or the module has no model). */
  private respondSecurity(h: string): string | null {
    const sec = this.securityModel();
    if (!sec) return null;
    const who = this.kwpKey();
    const svc = h.slice(0, 2);
    if (svc === '27' && h.length >= 4) {
      if ((this.secFailures.get(who) ?? 0) >= 3) return '7F2736';
      const sub = parseInt(h.slice(2, 4), 16);
      if (sub === sec.level) {
        if (this.secUnlocked.has(who)) return '67' + h.slice(2, 4) + toHex(sec.seed.map(() => 0));
        this.secSeedSent.add(who);
        return '67' + h.slice(2, 4) + toHex(sec.seed);
      }
      if (sub === sec.level + 1) {
        if (!this.secSeedSent.has(who)) return '7F2724';
        this.secSeedSent.delete(who);
        const key = parseHexBytes(h.slice(4));
        const match = key.length === sec.key.length && key.every((b, i) => b === sec.key[i]);
        if (match) {
          this.secUnlocked.add(who);
          this.secFailures.delete(who);
          return '67' + h.slice(2, 4);
        }
        const failures = (this.secFailures.get(who) ?? 0) + 1;
        this.secFailures.set(who, failures);
        return failures >= 3 ? '7F2736' : '7F2735';
      }
      return '7F2712';
    }
    if ((sec.protects as string[]).includes(svc) && !this.secUnlocked.has(who)) {
      return '7F' + svc + '33';
    }
    return null;
  }

  /** KWP2000 login (`2B`), ReadDataByLocalIdentifier (`21`) and WriteDataByLocalIdentifier (`3B`)
   *  — plan 22. Null when `h` is not one of them. */
  private respondKwp(h: string): string | null {
    if (h.startsWith('2B') && h.length === 12) {
      const want = this.scenario.kwpLogins?.[this.kwpKey()] ?? this.scenario.kwpLogins?.['*'];
      if (!want) return '7F2B11'; // this module has no login service
      const code = parseInt(h.slice(2, 6), 16);
      const wsc = parseInt(h.slice(6, 12), 16);
      if (code !== want.code || (want.wsc !== undefined && wsc !== want.wsc)) {
        this.loggedIn.delete(this.kwpKey());
        return '7F2B35';
      }
      this.loggedIn.add(this.kwpKey());
      return '6B';
    }
    if (h.startsWith('21') && h.length === 4) {
      const lid = h.slice(2, 4);
      const data = this.kwpStore()?.[lid];
      return data ? '61' + lid + toHex(data) : 'NO DATA';
    }
    if (h.startsWith('3B') && h.length >= 6) {
      const lid = h.slice(2, 4);
      const store = this.kwpStore();
      if (!store || !(lid in store)) return '7F3B31';
      if (this.scenario.kwpLoginRequired?.includes(lid) && !this.loggedIn.has(this.kwpKey())) {
        return '7F3B33';
      }
      store[lid] = parseHexBytes(h.slice(4));
      return '7B' + lid;
    }
    return null;
  }

  private respondObd(h0: string): string {
    const h = h0.replace(/\s+/g, '');

    // A stale receive filter blocks replies, exactly like on a real adapter: with default
    // (functional) addressing the engine answers on 0x7E8 — any other specific ATCRA left over
    // from module work makes every standard read time out. This is the regression guard for
    // resetAddressing().
    if (
      isCan(this.scenario.protocol) &&
      !this.header &&
      this.craFilter &&
      this.craFilter.toUpperCase() !== '7E8'
    ) {
      return 'NO DATA';
    }

    if (h === '0902') {
      const ok = this.scenario.vinSupported !== false && !!this.scenario.vin;
      return ok ? '4902' + '01' + toHex(asciiToBytes(this.scenario.vin as string)) : 'NO DATA';
    }
    if (h === '0904') {
      const cal = this.scenario.calibrationId;
      return cal ? '4904' + '01' + toHex(asciiToBytes(cal)) : 'NO DATA';
    }
    if (h === '03') return this.dtcLines(0x43, this.scenario.storedDtcs ?? [], (e) => e.storedDtcs);
    if (h === '07')
      return this.dtcLines(0x47, this.scenario.pendingDtcs ?? [], (e) => e.pendingDtcs);
    if (h === '0A') return this.dtcResponse(0x4a, this.scenario.permanentDtcs ?? []);
    if (h === '04') {
      this.scenario.storedDtcs = [];
      this.scenario.pendingDtcs = [];
      for (const ecu of this.scenario.secondaryEcus ?? []) {
        ecu.storedDtcs = [];
        ecu.pendingDtcs = [];
      }
      return '44';
    }

    // Mode 06: on-board monitor test results (06 <mid>).
    if (h.startsWith('06') && h.length === 4) {
      const mid = h.slice(2);
      const resp = this.scenario.mode06?.[mid];
      return resp ? toHex(resp) : 'NO DATA';
    }

    // UDS / KWP module services (coding, service reset).
    if (h.startsWith('10') && h.length >= 4) {
      // (Start)DiagnosticSession. Like a real module, a session (re)start drops a KWP login.
      this.loggedIn.delete(this.kwpKey());
      this.secUnlocked.delete(this.kwpKey());
      this.secSeedSent.delete(this.kwpKey());
      return '50' + h.slice(2, 4);
    }
    const secured = this.respondSecurity(h);
    if (secured !== null) return secured;
    const kwp = this.respondKwp(h);
    if (kwp !== null) return kwp;
    if (h === '3E00') return '7E00'; // TesterPresent
    // RoutineControl / StartRoutine (UDS 31 <sub> <id> or KWP 31 <lid>) — echo a positive response.
    if (h.startsWith('31') && h.length >= 4) {
      return '71' + h.slice(2);
    }
    if (h.startsWith('27') && h.length >= 4) {
      return h.slice(2, 4) === '01' ? '67010000' : '6702';
    }
    // UDS ReadDTCInformation (module scan). 0x19 0x02 <mask> -> 0x59 0x02 <mask> + records.
    if (h.startsWith('1902') && h.length === 6) {
      const store = this.header ? this.scenario.moduleDtcs?.[this.header] : undefined;
      if (!store) return 'NO DATA';
      const mask = parseInt(h.slice(4, 6), 16);
      const hits = store.filter((d) => mask === 0xff || (d.status & mask) !== 0);
      return '5902' + h.slice(4, 6) + hits.map((d) => toHex([...d.bytes, d.status])).join('');
    }
    // UDS reportDTCSnapshotRecordByDTCNumber. 0x19 0x04 <3B dtc> <rec> -> canned snapshot (RPM DID).
    if (h.startsWith('1904') && h.length === 12) {
      const store = this.header ? this.scenario.moduleDtcs?.[this.header] : undefined;
      const dtcHex = h.slice(4, 10);
      const known = store?.some((d) => toHex(d.bytes).toUpperCase() === dtcHex);
      if (!known) return 'NO DATA';
      const status = store?.find((d) => toHex(d.bytes).toUpperCase() === dtcHex)?.status ?? 0;
      return '5904' + dtcHex + toHex([status]) + '01' + '01' + '010C' + '0CD0';
    }
    // UDS InputOutputControlByIdentifier (output tests). 2F <did> <mode> [<data>] -> 6F echo.
    if (h.startsWith('2F') && h.length >= 8) {
      return '6F' + h.slice(2, 8);
    }
    // UDS ClearDiagnosticInformation for the addressed module. 0x14 FFFFFF -> 0x54.
    if (h.startsWith('14') && h.length === 8) {
      const store = this.header ? this.scenario.moduleDtcs?.[this.header] : undefined;
      if (!store) return 'NO DATA';
      store.length = 0;
      return '54';
    }
    if (h.startsWith('2E') && h.length >= 6) {
      const did = h.slice(2, 6);
      const data = parseHexBytes(h.slice(6));
      const store = this.header ? this.scenario.coding?.[this.header] : undefined;
      if (store && did in store) {
        store[did] = data;
        return '6E' + did;
      }
      return '7F2E31';
    }

    if (h.startsWith('22') && h.length >= 6) {
      const did = h.slice(2, 6);
      const coding = this.header ? this.scenario.coding?.[this.header]?.[did] : undefined;
      if (coding) return '62' + did + toHex(coding);
      const moduleData = this.header ? this.scenario.moduleDids?.[this.header]?.[did] : undefined;
      if (moduleData) return '62' + did + toHex(moduleData);
      const identText = this.header ? this.scenario.moduleIdent?.[this.header]?.[did] : undefined;
      if (identText) return '62' + did + toHex(asciiToBytes(identText));
      // Profile extended DIDs belong to the ENGINE ECU: they answer with default addressing or on
      // the engine's own header, never on another module's (on CAN) — otherwise every physically
      // addressed probe (`22 F187` module discovery, plan 25) would "find" the engine everywhere.
      const engineAddressed =
        !this.header || !isCan(this.scenario.protocol) || this.header === ENGINE_REQ_HEADER;
      const data = engineAddressed ? this.scenario.extendedDids?.[did] : undefined;
      return data ? '62' + did + toHex(data) : 'NO DATA';
    }

    // Mode 02 freeze frames — one per stored DTC (frame n belongs to stored[n]).
    if (h.startsWith('02') && h.length === 6) {
      const stored = this.scenario.storedDtcs ?? [];
      const pid = h.slice(2, 4);
      const frame = h.slice(4, 6);
      const idx = parseInt(frame, 16);
      if (Number.isNaN(idx) || idx >= stored.length) return 'NO DATA';
      if (pid === '02') {
        const [b0, b1] = encodeDtc(stored[idx]);
        return '42' + '02' + frame + toHex([b0, b1]);
      }
      const data = SIM_PID_BYTES[('01' + pid).toLowerCase()] ?? [0x00];
      return '42' + pid + frame + toHex(data);
    }

    // Mode 09 08/0B — IUPR.
    if (h === '0908') {
      const d = this.scenario.iuprSpark;
      return d ? '4908' + toHex(d) : 'NO DATA';
    }
    if (h === '090B') {
      const d = this.scenario.iuprCompression;
      return d ? '490B' + toHex(d) : 'NO DATA';
    }

    // Mode 05 — O2 monitoring results (tid + sensor).
    if (h.startsWith('05') && h.length === 6) {
      const resp = this.scenario.mode05?.[h.slice(2)];
      return resp ? toHex(resp) : 'NO DATA';
    }

    // Multi-PID Mode 01 request (CAN): 01 + up to six PID bytes -> 41 + [pid data]* for the
    // supported ones (unsupported PIDs are omitted, like a real ECU).
    if (h.startsWith('01') && h.length > 4 && h.length <= 14 && h.length % 2 === 0) {
      const pids = h.slice(2).match(/../g) ?? [];
      let body = '';
      for (const pb of pids) {
        const full = '01' + pb;
        if (!this.scenario.supportedPids.includes(full)) continue;
        const data = SIM_PID_BYTES[full.toLowerCase()] ?? [0x00];
        body += pb + toHex(data);
      }
      return body ? '41' + body : 'NO DATA';
    }

    if (h.length === 4 && h.startsWith('01')) {
      if (h === '0100' || h === '0120' || h === '0140' || h === '0160') {
        const lines = ['41' + h.slice(2) + toHex(encodeSupportedPids(h, this.supportedNums()))];
        const base = parseInt(h.slice(2), 16);
        for (const ecu of this.scenario.secondaryEcus ?? []) {
          const nums = ecu.supportedPids.map((p) => parseInt(p.slice(2), 16));
          // A real module answers a range only when it supports at least one PID in it; one that
          // supports nothing in 0x21–0x40 simply doesn't reply to 0120 (functional NO DATA from it).
          if (!nums.some((n) => n > base && n <= base + 0x20)) continue;
          lines.push('41' + h.slice(2) + toHex(encodeSupportedPids(h, nums)));
        }
        return this.maybeSearching() + lines.join('\r');
      }
      if (h === '0101') {
        const n = (this.scenario.storedDtcs ?? []).length;
        const a = (n > 0 ? 0x80 : 0) | (n & 0x7f);
        return '4101' + toHex([a, 0x07, 0x21, 0x00]);
      }
      if (this.scenario.supportedPids.includes(h)) {
        const data = SIM_PID_BYTES[h.toLowerCase()] ?? [0x00];
        return this.maybeSearching() + '41' + h.slice(2) + toHex(data);
      }
      return 'NO DATA';
    }

    return 'NO DATA';
  }
}
