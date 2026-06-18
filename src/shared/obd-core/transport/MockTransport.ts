/** A virtual ELM327 that implements Transport, so the whole app/test-suite runs with no hardware.
 *  See docs/simulator.md. */

import { Transport, TransportStatus } from './Transport';
import { ProtocolId, elmNumberFromProtocol } from '../obd/protocols';
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
    if (!cmd) return;
    const body = this.respond(cmd);
    const out = stringToBytes(body + '\r\r' + '>');
    const delay = this.scenario.latencyMs ?? 0;
    setTimeout(() => {
      for (const l of [...this.listeners]) l(out);
    }, delay);
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
      this.header = hh === '' ? null : hh;
      return 'OK';
    }
    if (
      c.startsWith('ATCRA') ||
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
      const data = this.scenario.extendedDids?.[did];
      return data ? '62' + did + toHex(data) : 'NO DATA';
    }

    // Mode 02 freeze frame.
    if (h.startsWith('02') && h.length === 6) {
      const stored = this.scenario.storedDtcs ?? [];
      if (stored.length === 0) return 'NO DATA';
      const pid = h.slice(2, 4);
      const frame = h.slice(4, 6);
      if (pid === '02') {
        const [b0, b1] = encodeDtc(stored[0]);
        return '42' + '02' + frame + toHex([b0, b1]);
      }
      const data = SIM_PID_BYTES[('01' + pid).toLowerCase()] ?? [0x00];
      return '42' + pid + frame + toHex(data);
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
