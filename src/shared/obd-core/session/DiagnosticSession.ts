/** High-level orchestration used by the UI: connect → init → identify → poll → read/clear DTCs.
 *  Talks to an ELM327 over any Transport. See docs/architecture.md. */

import { Elm327Client, Elm327Options } from '../elm327/Elm327Client';
import { Transport } from '../transport/Transport';
import { ProtocolId } from '../obd/protocols';
import { decodeSupportedPids } from '../obd/supportedPids';
import { isMarkerPid, decodePid, PID_REGISTRY } from '../obd/pids';
import { parseDtcBytes, toDtc, Dtc } from '../obd/dtc';
import { parseVin } from '../obd/vin';

export interface LiveValue {
  pid: string;
  name: string;
  unit: string;
  value: number;
  ts: number;
}

export interface SessionInfo {
  protocol: ProtocolId;
  voltage: number | null;
  version: string;
  supportedPids: string[];
  vin: string | null;
}

export type DtcKind = '03' | '07' | '0A';

export class DiagnosticSession {
  readonly client: Elm327Client;
  private supported: string[] = [];
  private protocol: ProtocolId = 'UNKNOWN';

  constructor(
    private transport: Transport,
    options?: Elm327Options,
  ) {
    this.client = new Elm327Client(transport, options);
  }

  get supportedPids(): string[] {
    return this.supported;
  }

  get currentProtocol(): ProtocolId {
    return this.protocol;
  }

  async connect(): Promise<SessionInfo> {
    if (this.transport.status !== 'connected') await this.transport.connect();
    this.client.attach();
    await this.client.init();
    await this.client.probe();
    this.protocol = await this.client.protocolNumber();
    const voltage = await this.client.voltage();
    const version = await this.client.version();
    this.supported = await this.discoverSupportedPids();
    const vin = await this.readVin();
    return { protocol: this.protocol, voltage, version, supportedPids: this.supported, vin };
  }

  /** Walk the 0100/0120/0140/0160 bitmaps, collecting the real (non-marker) supported PIDs. */
  async discoverSupportedPids(): Promise<string[]> {
    const ranges = ['0100', '0120', '0140', '0160'];
    const found: string[] = [];
    for (const req of ranges) {
      const r = await this.client.command(req);
      if (r.notice || r.bytes.length < 6) break;
      const decoded = decodeSupportedPids(req, r.bytes.slice(2));
      for (const p of decoded) if (!isMarkerPid(p) && !found.includes(p)) found.push(p);
      if (!decoded.some(isMarkerPid)) break;
    }
    this.supported = found;
    return found;
  }

  /** PIDs we can actually show: ECU-supported ∩ profile list (if any), limited to decodable PIDs. */
  effectivePids(profilePids?: string[]): string[] {
    const base = this.supported.length ? this.supported : Object.keys(PID_REGISTRY);
    const known = base.filter((p) => PID_REGISTRY[p]);
    if (!profilePids || profilePids.length === 0) return known;
    return known.filter((p) => profilePids.includes(p));
  }

  async readValue(pid: string): Promise<LiveValue | null> {
    const r = await this.client.command(pid);
    if (r.notice || r.bytes.length < 2) return null;
    const value = decodePid(pid, r.bytes.slice(2));
    if (value === null) return null;
    const d = PID_REGISTRY[pid];
    return { pid, name: d.name, unit: d.unit, value, ts: Date.now() };
  }

  async pollOnce(pids: string[]): Promise<Record<string, LiveValue>> {
    const out: Record<string, LiveValue> = {};
    for (const pid of pids) {
      const v = await this.readValue(pid);
      if (v) out[pid] = v;
    }
    return out;
  }

  async readDtcs(kind: DtcKind = '03'): Promise<Dtc[]> {
    const r = await this.client.command(kind);
    if (r.notice) return [];
    const service = parseInt('4' + kind[1], 16); // 0x43 / 0x47 / 0x4A
    const data = r.bytes[0] === service ? r.bytes.slice(1) : r.bytes;
    return parseDtcBytes(data).map(toDtc);
  }

  async clearDtcs(): Promise<boolean> {
    const r = await this.client.command('04');
    return r.notice === null;
  }

  async readVin(): Promise<string | null> {
    const r = await this.client.command('0902');
    if (r.notice || r.bytes.length < 3) return null;
    const vin = parseVin(r.bytes);
    return vin.length > 0 ? vin : null;
  }

  /** Experimental Mode 22 read; returns the data bytes after `62 <did>`. */
  async readExtended(did: string): Promise<number[] | null> {
    const r = await this.client.command('22' + did);
    if (r.notice || r.bytes.length < 1) return null;
    return r.bytes.slice(1 + did.length / 2);
  }
}
