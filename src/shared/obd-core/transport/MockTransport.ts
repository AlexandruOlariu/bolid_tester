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
  extendedDids?: Record<string, number[]>; // '1701' -> response data bytes (Mode 22)
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
  latencyMs?: number;
  emitSearching?: boolean;
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

export class MockTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private listeners = new Set<(b: Uint8Array) => void>();
  private searched = false;
  private header: string | null = null; // current ATSH target (module addressing)
  /** Current ATCRA receive filter — modelled so a stale filter breaks reads like on a real
   *  adapter (regression guard for the restore-addressing paths). */
  private craFilter: string | null = null;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private monitorIdx = 0;

  constructor(public scenario: SimScenario) {}

  async connect(): Promise<void> {
    this.status = 'connecting';
    this.status = 'connected';
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
  }

  onData(listener: (b: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async write(bytes: Uint8Array): Promise<void> {
    const cmd = bytesToString(bytes).replace(/[\r\n]+$/g, '').trim();
    // Any byte interrupts monitor mode (like a real ELM327), answering with a prompt.
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
      if (!cmd) {
        const out = stringToBytes('\r>');
        setTimeout(() => {
          for (const l of [...this.listeners]) l(out);
        }, this.scenario.latencyMs ?? 0);
        return;
      }
    }
    if (!cmd) return;
    // ATMA starts streaming monitor lines with NO prompt until interrupted.
    if (cmd.toUpperCase() === 'ATMA') {
      const frames = this.scenario.monitorFrames ?? [];
      this.monitorIdx = 0;
      this.monitorTimer = setInterval(() => {
        if (!frames.length) return;
        const line = frames[this.monitorIdx % frames.length];
        this.monitorIdx += 1;
        const out = stringToBytes(line + '\r');
        for (const l of [...this.listeners]) l(out);
      }, 30);
      return;
    }
    const body = this.shapeResponse(cmd, this.respond(cmd));
    const out = stringToBytes(body + '\r\r' + '>');
    const delay = this.scenario.latencyMs ?? 0;
    setTimeout(() => {
      for (const l of [...this.listeners]) l(out);
    }, delay);
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
      ['ATE0', 'ATE1', 'ATL0', 'ATL1', 'ATS0', 'ATS1', 'ATH0', 'ATH1', 'ATAT0', 'ATAT1', 'ATAT2', 'ATCAF0', 'ATCAF1'].includes(c)
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
    if (h === '03') return this.dtcResponse(0x43, this.scenario.storedDtcs ?? []);
    if (h === '07') return this.dtcResponse(0x47, this.scenario.pendingDtcs ?? []);
    if (h === '0A') return this.dtcResponse(0x4a, this.scenario.permanentDtcs ?? []);
    if (h === '04') {
      this.scenario.storedDtcs = [];
      this.scenario.pendingDtcs = [];
      return '44';
    }

    // Mode 06: on-board monitor test results (06 <mid>).
    if (h.startsWith('06') && h.length === 4) {
      const mid = h.slice(2);
      const resp = this.scenario.mode06?.[mid];
      return resp ? toHex(resp) : 'NO DATA';
    }

    // UDS / KWP module services (coding, service reset).
    if (h.startsWith('10') && h.length >= 4) return '50' + h.slice(2, 4); // (Start)DiagnosticSession
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
      const data = this.scenario.extendedDids?.[did];
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
        const data = encodeSupportedPids(h, this.supportedNums());
        return this.maybeSearching() + '41' + h.slice(2) + toHex(data);
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
