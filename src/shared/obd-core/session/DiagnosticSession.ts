/** High-level orchestration used by the UI: connect → init → identify → poll → read/clear DTCs.
 *  Talks to an ELM327 over any Transport. See docs/architecture.md. */

import { Elm327Client, Elm327Options } from '../elm327/Elm327Client';
import { Transport } from '../transport/Transport';
import { ProtocolId, isKLine, isCan, functionalHeader } from '../obd/protocols';
import { chunkPids, buildMultiPidRequest, parseMultiPidResponse } from '../obd/multiPid';
import { decodeIupr, IuprReport } from '../obd/iupr';
import { decodeMode05, Mode05Result } from '../obd/mode05';
import { decodeSupportedPids } from '../obd/supportedPids';
import { isMarkerPid, decodePid, PID_REGISTRY } from '../obd/pids';
import { parseDtcBytes, decodeDtcBytes, toDtc, Dtc } from '../obd/dtc';
import { parseVin, parseCalibrationId } from '../obd/vin';
import { decodeMonitorStatus, MonitorStatus } from '../obd/readiness';
import { decodeMode06, Mode06Result } from '../obd/mode06';

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
  calibrationId: string | null;
  /** Engine ECU part number (UDS `22 F187`, ASCII), read once after connect on CAN when the active
   *  profile declares extended PIDs — resolves the label pack for measuring groups (plan 14). Set
   *  by the connection service, never by `connect()`. */
  partNumber?: string;
}

export type DtcKind = '03' | '07' | '0A';

export interface FreezeFrame {
  triggerDtc: string | null;
  values: LiveValue[];
  /** Mode 02 frame index this snapshot came from (0 = first). */
  frame?: number;
}

/** Default PIDs captured in the freeze frame view. */
const FREEZE_PIDS = ['010C', '0105', '010D', '0104', '010B', '0111'];

/** The steps of `DiagnosticSession.connect`, reported through its `onStage` callback. */
export type ConnectProgressStage = 'init' | 'probe' | 'identify';

export class DiagnosticSession {
  readonly client: Elm327Client;
  private supported: string[] = [];
  private protocol: ProtocolId = 'UNKNOWN';
  /** Memoised `readPartNumber` result (including a `null` "no answer") for this connection. */
  private partNumberRead: Promise<string | null> | null = null;

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

  async disconnect(): Promise<void> {
    this.client.detach();
    try {
      await this.transport.disconnect();
    } catch {
      // best-effort
    }
  }

  /** Connect, init the adapter, probe the car and read its details. `onStage` reports each step as
   *  it begins (`init` = adapter AT setup, `probe` = the first `0100` to the car, `identify` =
   *  protocol / voltage / PID bitmaps / VIN), so a failure can say how far the attempt got. */
  async connect(onStage?: (stage: ConnectProgressStage) => void): Promise<SessionInfo> {
    if (this.transport.status !== 'connected') await this.transport.connect();
    this.client.attach();
    onStage?.('init');
    await this.client.init();
    onStage?.('probe');

    // The AT setup above is answered by the adapter itself; `0100` is the first request that has to
    // reach the car's ECU. If it gets no reply, every later read would fail the same way — so stop
    // here with an actionable message instead of grinding through more timeouts on "Initializing…".
    let probed = false;
    try {
      probed = await this.client.probe();
    } catch {
      probed = false;
    }
    if (!probed) {
      throw new Error(
        'Connected to the adapter, but the vehicle isn’t responding (no reply to OBD2 “0100”). ' +
          'Turn the ignition to ON — engine running is most reliable — and make sure the adapter is ' +
          'fully seated in the OBD2 port, then reconnect.',
      );
    }

    onStage?.('identify');
    this.protocol = await this.client.protocolNumber();
    // K-line (ISO 9141-2 / KWP2000) is slower than CAN; give every command a longer timeout so
    // Mode 03/07/04 and KWP routines don't reject prematurely.
    if (isKLine(this.protocol)) this.client.setSlow();
    const voltage = await this.client.voltage();
    const version = await this.client.version();
    this.supported = await this.discoverSupportedPids();
    const vin = await this.readVin();
    const calibrationId = await this.readCalibrationId();
    return {
      protocol: this.protocol,
      voltage,
      version,
      supportedPids: this.supported,
      vin,
      calibrationId,
    };
  }

  /** Walk the 0100/0120/0140/0160 bitmaps, collecting the real (non-marker) supported PIDs.
   *
   *  Multi-ECU: `0100` is a functional (broadcast) request, so on a car where several ECUs answer
   *  (engine + transmission/aux) each replies on its own line. The set of PIDs the app can read is
   *  the UNION of what any ECU supports, so we OR the per-frame bitmaps — the correct semantics for
   *  a functional query. (The old single-`bytes` path concatenated the lines and hex-parsed the
   *  blob, fabricating garbage.) We keep walking to the next range while ANY responding ECU still
   *  flags a higher range via its marker PID. Single-ECU behaviour is identical to before. */
  async discoverSupportedPids(): Promise<string[]> {
    const ranges = ['0100', '0120', '0140', '0160'];
    const found: string[] = [];
    for (const req of ranges) {
      const r = await this.client.command(req);
      if (r.notice) break;
      const frames = r.frames.length ? r.frames : r.bytes.length ? [r.bytes] : [];
      let anyValid = false;
      let anyMarker = false;
      for (const frame of frames) {
        if (frame.length < 6) continue;
        anyValid = true;
        const decoded = decodeSupportedPids(req, frame.slice(2));
        for (const p of decoded) if (!isMarkerPid(p) && !found.includes(p)) found.push(p);
        if (decoded.some(isMarkerPid)) anyMarker = true;
      }
      if (!anyValid || !anyMarker) break;
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
    // `r.bytes` is the first responding frame. Mode 01 live PIDs are answered only by the engine
    // ECU in practice, so single-frame; if another module ever also answers, first-frame is the
    // engine's value (not a multi-ECU concatenation) — see ParsedResponse.bytes.
    if (r.notice || r.bytes.length < 2) return null;
    const value = decodePid(pid, r.bytes.slice(2));
    if (value === null) return null;
    const d = PID_REGISTRY[pid];
    return { pid, name: d.name, unit: d.unit, value, ts: Date.now() };
  }

  /** Poll a set of PIDs once. On CAN links Mode 01 PIDs are batched (up to 6 per request,
   *  ISO 15765-4) — a ~3–6× faster loop for live data/charts. Any chunk that cannot be parsed
   *  falls back to serial single-PID polling, so clone quirks degrade gracefully. */
  async pollOnce(pids: string[]): Promise<Record<string, LiveValue>> {
    const out: Record<string, LiveValue> = {};
    const serial: string[] = [];
    const batchable = isCan(this.protocol) ? pids.filter((p) => p.startsWith('01')) : [];
    for (const pid of pids) if (!batchable.includes(pid)) serial.push(pid);

    if (batchable.length >= 2) {
      for (const chunk of chunkPids(batchable)) {
        const entries = await this.pollChunk(chunk);
        if (entries === null) {
          serial.push(...chunk);
          continue;
        }
        const ts = Date.now();
        for (const { pid, data } of entries) {
          if (!chunk.includes(pid)) continue;
          const value = decodePid(pid, data);
          const d = PID_REGISTRY[pid];
          if (value !== null && d) out[pid] = { pid, name: d.name, unit: d.unit, value, ts };
        }
      }
    } else {
      serial.push(...batchable);
    }

    for (const pid of serial) {
      const v = await this.readValue(pid);
      if (v) out[pid] = v;
    }
    return out;
  }

  private async pollChunk(chunk: string[]): Promise<{ pid: string; data: number[] }[] | null> {
    try {
      const r = await this.client.command(buildMultiPidRequest(chunk));
      if (r.notice) return null;
      return parseMultiPidResponse(r.bytes);
    } catch {
      return null;
    }
  }

  async readDtcs(kind: DtcKind = '03'): Promise<Dtc[]> {
    const r = await this.client.command(kind);
    if (r.notice) return [];
    const service = parseInt('4' + kind[1], 16); // 0x43 / 0x47 / 0x4A
    // Parse each responding ECU's frame independently. Mode 03/07/0A is functional, so with headers
    // off a multi-ECU car (engine + transmission/aux) returns ONE LINE PER ECU. Stripping only the
    // first 0x43 and hex-parsing the concatenation used to fold a second ECU's `43` service byte
    // into the DTC byte stream → phantom/garbled codes. Here we strip each frame's own service byte,
    // decode per frame, then merge and dedupe (two ECUs can legitimately report the same code, e.g.
    // U0100). Single-frame (single-ECU) behaviour is identical to before.
    const frames = r.frames.length ? r.frames : r.bytes.length ? [r.bytes] : [];
    const codes: string[] = [];
    const seen = new Set<string>();
    for (const frame of frames) {
      const data = frame[0] === service ? frame.slice(1) : frame;
      for (const code of parseDtcBytes(data)) {
        if (!seen.has(code)) {
          seen.add(code);
          codes.push(code);
        }
      }
    }
    return codes.map((c) => toDtc(c));
  }

  async clearDtcs(): Promise<boolean> {
    const r = await this.client.command('04');
    return r.notice === null;
  }

  async readVin(): Promise<string | null> {
    const r = await this.client.command('0902');
    // 0902 is functional but the VIN is >7 bytes, so on CAN it arrives as an ISO-TP multi-frame
    // message → a SINGLE reassembled frame (`r.bytes`). No multi-ECU concatenation exposure here.
    if (r.notice || r.bytes.length < 3) return null;
    const vin = parseVin(r.bytes);
    return vin.length > 0 ? vin : null;
  }

  /** Calibration ID (Mode 09 PID 04) — the ECU software/calibration identifier (e.g. on the B5.5,
   *  "038906019KC 4896"). Returns null when the ECU does not answer Mode 09 PID 04. */
  async readCalibrationId(): Promise<string | null> {
    const r = await this.client.command('0904');
    if (r.notice || r.bytes.length < 3) return null;
    const cal = parseCalibrationId(r.bytes);
    return cal.length > 0 ? cal : null;
  }

  /** Experimental Mode 22 read; returns the data bytes after `62 <did>`. */
  async readExtended(did: string): Promise<number[] | null> {
    const r = await this.client.command('22' + did);
    if (r.notice || r.bytes.length < 1) return null;
    return r.bytes.slice(1 + did.length / 2);
  }

  /** The engine ECU's part number (UDS `22 F187`, printable ASCII, trimmed) on the default header,
   *  or null when it does not answer. CAN only. Resolves the label pack (measuring groups).
   *
   *  Sent at most ONCE per session: the outcome — a part number or a `null` "no answer" — is
   *  memoised (as is an in-flight read), so the connect-time read and any later retry (EngineHost,
   *  on a profile switch) share one `22 F187` instead of paying another NO DATA timeout each. Only a
   *  read that throws (a link error) is forgotten, so a later call may try again. */
  readPartNumber(): Promise<string | null> {
    if (!isCan(this.protocol)) return Promise.resolve(null);
    if (!this.partNumberRead) {
      const read = this.fetchPartNumber();
      this.partNumberRead = read;
      void read.catch(() => {
        if (this.partNumberRead === read) this.partNumberRead = null;
      });
    }
    return this.partNumberRead;
  }

  private async fetchPartNumber(): Promise<string | null> {
    const raw = (await this.pollExtendedOnce(['F187']))['F187'];
    if (!raw) return null;
    const text = raw
      .filter((b) => b >= 0x20 && b <= 0x7e)
      .map((b) => String.fromCharCode(b))
      .join('')
      .trim();
    return text.length > 0 ? text : null;
  }

  /** One sweep of extended (Mode 22) reads for the live poll loop: sequential `22 <did>` requests
   *  on the CURRENT header (engine / default addressing — it never changes addressing). Returns the
   *  data bytes after `62 <did>` per DID, or null for NO DATA / a negative response / a reply for
   *  another DID. Sequential on purpose: multi-DID `22` requests are ECU-dependent and the ISO-TP
   *  reply outgrows one frame (batching is a later optimisation). Off CAN it sends nothing and
   *  returns null for every DID — Mode 22 does not apply to K-line. */
  async pollExtendedOnce(dids: string[]): Promise<Record<string, number[] | null>> {
    const out: Record<string, number[] | null> = {};
    if (!isCan(this.protocol)) {
      for (const did of dids) out[did] = null;
      return out;
    }
    for (const did of dids) {
      const r = await this.client.command('22' + did);
      const b = r.bytes;
      const echo = parseInt(did, 16);
      const ok = !r.notice && b.length >= 3 && b[0] === 0x62 && ((b[1] << 8) | b[2]) === echo;
      out[did] = ok ? b.slice(3) : null;
    }
    return out;
  }

  /** Low-level UDS/raw send: resolves with response bytes (service byte first) or null on a notice.
   *  Used by the coding flow (obd-core/coding/udsCoding) and module sensor reads. */
  async send(cmd: string): Promise<number[] | null> {
    const r = await this.client.command(cmd);
    return r.notice ? null : r.bytes;
  }

  /** Point subsequent requests at a specific module (physical addressing). Pass null to restore
   *  the protocol's default functional header: bare `ATSH` is NOT a valid ELM327 command — real
   *  adapters answer `?` and keep the old header, which used to leave the adapter stuck on the
   *  last-scanned module while the simulator (which accepted bare ATSH) hid it. */
  async setHeader(header: string | null): Promise<void> {
    const target = header ?? functionalHeader(this.protocol);
    if (!target) return; // unknown/29-bit protocol: nothing safe to restore to
    await this.client.command('ATSH' + target);
  }

  /** Narrow the adapter's receive filter to one CAN id (`ATCRA hhh`). Pass null to clear it
   *  (bare `ATCRA`, v1.4b+) — a stale filter blocks every other ECU's replies. CAN only. */
  async setRxFilter(filter: string | null): Promise<void> {
    if (!isCan(this.protocol) && filter === null) return; // ATCRA is a CAN command
    await this.client.command('ATCRA' + (filter ?? ''));
  }

  /** Restore default addressing after module-scoped work (scan, adaptations, routines, coding):
   *  functional header + no receive filter. Call in a `finally` — leaving either set kills all
   *  standard OBD2 reads until reconnect. */
  async resetAddressing(): Promise<void> {
    await this.setHeader(null);
    await this.setRxFilter(null);
  }

  /** Mode 06 — on-board monitor test results for a monitor id (e.g. '01'). */
  async readMode06(mid: string): Promise<Mode06Result[]> {
    const r = await this.client.command('06' + mid);
    if (r.notice) return [];
    return decodeMode06(r.bytes);
  }

  /** Start the CAN sniffer: headers on, then ATMA streaming raw frames to the listener. The
   *  command channel is exclusively the monitor's until stopSniffer(). */
  async startSniffer(onLine: (line: string) => void): Promise<void> {
    await this.client.raw('ATH1');
    await this.client.startMonitor(onLine);
  }

  /** Stop the sniffer and restore normal (headers-off) operation. */
  async stopSniffer(): Promise<void> {
    await this.client.stopMonitor();
    await this.client.raw('ATH0');
  }

  get sniffing(): boolean {
    return this.client.monitoring;
  }

  /** MIL state + readiness monitors (Mode 01 PID 01). */
  async readReadiness(): Promise<MonitorStatus | null> {
    const r = await this.client.command('0101');
    // 0101 is functional and several ECUs can answer, but MIL state + readiness belong to the
    // PRIMARY (engine) ECU. `r.bytes` is the first responding frame — the engine on the lowest CAN
    // id (7E8) — so this reads the right module and no longer risks the multi-ECU byte-concatenation
    // garble. (If per-ECU readiness merging is ever wanted, `r.frames` carries every ECU's answer.)
    if (r.notice || r.bytes.length < 6) return null;
    return decodeMonitorStatus(r.bytes.slice(2));
  }

  /** Freeze-frame snapshot (Mode 02) at frame 0 — kept for compatibility. */
  async readFreezeFrame(pids: string[] = FREEZE_PIDS): Promise<FreezeFrame> {
    return this.readFreezeFrameAt(0, pids);
  }

  /** One freeze frame by index: its triggering DTC + the captured PIDs. */
  async readFreezeFrameAt(frame: number, pids: string[] = FREEZE_PIDS): Promise<FreezeFrame> {
    const fh = frame.toString(16).padStart(2, '0').toUpperCase();
    const trigger = await this.client.command('0202' + fh);
    let triggerDtc: string | null = null;
    if (!trigger.notice && trigger.bytes.length >= 5) {
      triggerDtc = decodeDtcBytes(trigger.bytes[3], trigger.bytes[4]) || null;
    }
    const values: LiveValue[] = [];
    if (triggerDtc) {
      for (const pid of pids) {
        const v = await this.readFreezeValue(pid, fh);
        if (v) values.push(v);
      }
    }
    return { triggerDtc, values, frame };
  }

  /** Every stored freeze frame (one per stored DTC on most CAN ECUs), stopping at the first
   *  frame with no trigger DTC. */
  async readFreezeFrames(pids: string[] = FREEZE_PIDS, maxFrames = 5): Promise<FreezeFrame[]> {
    const frames: FreezeFrame[] = [];
    for (let f = 0; f < maxFrames; f++) {
      const frame = await this.readFreezeFrameAt(f, pids);
      if (!frame.triggerDtc) break;
      frames.push(frame);
    }
    return frames;
  }

  /** In-use performance ratios: Mode 09 PID 08 (spark) / 0B (compression). Null if unsupported. */
  async readIupr(): Promise<IuprReport | null> {
    for (const pid of ['0908', '090B']) {
      const r = await this.client.command(pid);
      if (r.notice || r.bytes.length < 3) continue;
      const report = decodeIupr(r.bytes);
      if (report) return report;
    }
    return null;
  }

  /** Mode 05 O2 monitoring result (non-CAN links only — CAN cars use Mode 06). */
  async readMode05(tid: string, sensor = '01'): Promise<Mode05Result | null> {
    if (isCan(this.protocol)) return null;
    const r = await this.client.command('05' + tid + sensor);
    if (r.notice) return null;
    return decodeMode05(r.bytes);
  }

  private async readFreezeValue(pid: string, frame = '00'): Promise<LiveValue | null> {
    const r = await this.client.command('02' + pid.slice(2) + frame);
    if (r.notice || r.bytes.length < 4) return null;
    const value = decodePid(pid, r.bytes.slice(3));
    if (value === null) return null;
    const d = PID_REGISTRY[pid];
    return { pid, name: d.name, unit: d.unit, value, ts: Date.now() };
  }
}
