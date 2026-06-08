/** A virtual ELM327 that implements Transport, so the whole app/test-suite runs with no hardware.
 *  See docs/simulator.md. */

import { Transport, TransportStatus } from './Transport';
import { ProtocolId, elmNumberFromProtocol } from '../obd/protocols';
import { encodeSupportedPids } from '../obd/supportedPids';
import { encodeDtc } from '../obd/dtc';
import { asciiToBytes, bytesToString, stringToBytes } from '../../lib/bytes';
import { byteToHex, toHex } from '../../lib/hex';

export interface SimScenario {
  protocol: ProtocolId;
  supportedPids: string[]; // '0104' etc — the PIDs this ECU reports
  vin?: string;
  vinSupported?: boolean; // default true if vin set
  storedDtcs?: string[];
  pendingDtcs?: string[];
  permanentDtcs?: string[];
  extendedDids?: Record<string, number[]>; // '1701' -> response data bytes (Mode 22)
  latencyMs?: number;
  emitSearching?: boolean;
}

/** Realistic raw data bytes per PID, chosen to decode to plausible idle values. */
const SIM_PID_BYTES: Record<string, number[]> = {
  '0104': [0x40], // load ~25%
  '0105': [0x7d], // coolant 85°C
  '0106': [0x80], // STFT 0%
  '0107': [0x80], // LTFT 0%
  '010a': [0x64], // fuel pressure 300 kPa
  '010b': [0x64], // MAP 100 kPa
  '010c': [0x0c, 0xd0], // RPM 820
  '010d': [0x00], // speed 0
  '010e': [0x94], // timing 10°
  '010f': [0x46], // IAT 30°C
  '0110': [0x01, 0x5e], // MAF 3.5 g/s
  '0111': [0x24], // throttle 14%
  '011f': [0x00, 0x78], // run time 120 s
  '0121': [0x00, 0x00], // distance w/ MIL 0
  '0131': [0x04, 0xd2], // distance since clear 1234 km
  '012f': [0x80], // fuel level 50%
  '0133': [0x64], // baro 100 kPa
  '0142': [0x36, 0xb0], // voltage 14.0 V
  '0146': [0x3e], // ambient 22°C
  '015c': [0x82], // oil temp 90°C
  '015e': [0x00, 0x1e], // fuel rate 1.5 L/h
};

export class MockTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private listeners = new Set<(b: Uint8Array) => void>();
  private searched = false;

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
    if (
      c.startsWith('ATCRA') ||
      c.startsWith('ATST') ||
      c.startsWith('ATSH') ||
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
    if (h === '03') return this.dtcResponse(0x43, this.scenario.storedDtcs ?? []);
    if (h === '07') return this.dtcResponse(0x47, this.scenario.pendingDtcs ?? []);
    if (h === '0A') return this.dtcResponse(0x4a, this.scenario.permanentDtcs ?? []);
    if (h === '04') {
      this.scenario.storedDtcs = [];
      this.scenario.pendingDtcs = [];
      return '44';
    }
    if (h.startsWith('22') && h.length >= 4) {
      const did = h.slice(2);
      const data = this.scenario.extendedDids?.[did];
      return data ? '62' + did + toHex(data) : 'NO DATA';
    }

    // Mode 02 freeze frame: `02 <pid> <frame>` → `42 <pid> <frame> <data>` (only if a DTC is set).
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
        // B=0x07: 3 continuous monitors supported & complete (spark); C/D: catalyst + O2 complete.
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
