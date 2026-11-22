/** The read-only session facade the AI diagnostic agent's tools receive instead of a
 *  `DiagnosticSession` (plan 34a). It exposes the session's reads and nothing that writes: no
 *  `clearDtcs`, no raw `send`, no `setHeader` / `setRxFilter`, no `client`, no sniffer controls (only
 *  `listenBus`, a bounded passive monitor window). Raw requests pass a read-request allowlist before
 *  any byte goes out, module addressing happens only through `withModule` (inside
 *  `DiagnosticSession.exclusive`, addressing restored in `finally`), and the airbag (15) and
 *  immobilizer (25) modules are refused outright. See docs/features/ai-diagnose.md. */

import type {
  DiagnosticSession,
  DtcKind,
  FreezeFrame,
  LiveValue,
} from '../session/DiagnosticSession';
import type { UdsSend } from '../coding/udsCoding';
import { isCan, type ProtocolId } from '../obd/protocols';
import type { Dtc } from '../obd/dtc';
import type { MonitorStatus } from '../obd/readiness';
import type { Mode06Result } from '../obd/mode06';
import type { Mode05Result } from '../obd/mode05';
import type { IuprReport } from '../obd/iupr';
import { MONITOR_UNAVAILABLE_MESSAGE } from '../transport/Transport';
import { VAG_UDS_HEADER_CANDIDATES } from '../uds/vagHeaders';

/** VAG diagnostic addresses the agent never addresses: 15 airbag, 25 immobilizer. */
export const AGENT_EXCLUDED_MODULE_ADDRESSES = ['15', '25'] as const;

/** The longest window `listenBus` monitors the bus for. */
export const BUS_LISTEN_MAX_MS = 10_000;

/** Why `listenBus` refuses a car that is not on CAN (the ELM monitor shows little on K-line). */
export const BUS_LISTEN_NEEDS_CAN_MESSAGE = 'Bus listening needs a CAN car.';

/** Why `listenBus` refuses while another monitor run (the sniffer screen) holds the adapter. */
export const BUS_LISTEN_BUSY_MESSAGE = 'The bus monitor is already running.';

/** A request outside the read allowlist was refused before anything was sent. */
export class WriteBlockedError extends Error {
  constructor(cmd: string) {
    super(`Blocked: ${cmd} is not a read request.`);
    this.name = 'WriteBlockedError';
  }
}

/** A module outside the agent's scope (airbag / immobilizer) was refused before any traffic. */
export class ModuleNotAllowedError extends Error {
  constructor(address: string) {
    super(`Module ${address} is outside the agent's scope.`);
    this.name = 'ModuleNotAllowedError';
  }
}

/** Services (first request byte) that only read: OBD2 modes 01 02 03 06 07 09 0A, UDS
 *  ReadDTCInformation (19), KWP ReadEcuIdentification (1A) / ReadDataByLocalId (21), ReadDataById
 *  (22) and TesterPresent (3E). `10` (session control) is handled separately. */
const READ_SERVICES = new Set('01 02 03 06 07 09 0A 19 1A 21 22 3E'.split(' '));

/** `10` sub-functions that cannot program: 01 default, 03 extended (UDS), 81 / 89 KWP standard /
 *  manufacturer-specific. Never 02 (UDS programming) or 85 (ISO 14230 ECU programming mode). */
const READ_SESSIONS = new Set('01 03 81 89'.split(' '));

/** True when `cmd` (hex, spaces ignored) is a read request: its service is on the read allowlist,
 *  or it is a `10` session change to a non-programming session. Adapter (`AT…`) commands, odd-length
 *  or non-hex input and everything else (`04 14 2E 2F 31 3B 27 28 10 02 10 85 …`) are refused. */
export function isReadOnlyRequest(cmd: string): boolean {
  const hex = cmd.replace(/\s+/g, '').toUpperCase();
  if (hex.length < 2 || hex.length % 2 !== 0 || !/^[0-9A-F]+$/.test(hex)) return false;
  const service = hex.slice(0, 2);
  if (service === '10') return READ_SESSIONS.has(hex.slice(2, 4));
  return READ_SERVICES.has(service);
}

/** One module's addressing for `withModule`: its VAG diagnostic address (when known), the tester →
 *  module CAN id (`ATSH`) and the module → tester id (`ATCRA`). */
export interface ModuleAddress {
  address?: string;
  reqHeader: string;
  rxFilter?: string;
}

export interface ReadOnlySession {
  readonly currentProtocol: ProtocolId;
  readonly supportedPids: readonly string[];
  readonly canMonitor: boolean;
  effectivePids(profilePids?: string[]): string[];
  readValue(pid: string): Promise<LiveValue | null>;
  pollOnce(pids: string[]): Promise<Record<string, LiveValue>>;
  readDtcs(kind: DtcKind): Promise<Dtc[]>;
  readReadiness(): Promise<MonitorStatus | null>;
  readFreezeFrame(pids?: string[]): Promise<FreezeFrame>;
  readFreezeFrames(pids?: string[], maxFrames?: number): Promise<FreezeFrame[]>;
  readVin(): Promise<string | null>;
  readCalibrationId(): Promise<string | null>;
  readPartNumber(): Promise<string | null>;
  readExtended(did: string): Promise<number[] | null>;
  pollExtendedOnce(dids: string[]): Promise<Record<string, number[] | null>>;
  readMode06(mid: string): Promise<Mode06Result[]>;
  readMode05(tid: string, sensor?: string): Promise<Mode05Result | null>;
  readIupr(): Promise<IuprReport | null>;
  voltage(): Promise<number | null>;
  adapterVersion(): Promise<string>;
  protocolNumber(): Promise<ProtocolId>;
  /** One raw request on the default addressing, refused with `WriteBlockedError` unless `isReadOnlyRequest`. */
  request(cmd: string): Promise<number[] | null>;
  /** Address one module, hand `fn` a read-filtered `send`, restore addressing in `finally`. */
  withModule<T>(addr: ModuleAddress, fn: (send: UdsSend) => Promise<T>): Promise<T>;
  /** Listen to the CAN bus for `ms` (clamped to `BUS_LISTEN_MAX_MS`) with the adapter's passive
   *  monitor (`ATMA`, headers on) and return every line heard. Nothing goes out on the bus; the
   *  monitor is stopped (headers off again) in `finally`. Rejects before sending anything with
   *  `MONITOR_UNAVAILABLE_MESSAGE` when the link cannot stream the monitor, and with
   *  `BUS_LISTEN_NEEDS_CAN_MESSAGE` off CAN (`BUS_LISTEN_BUSY_MESSAGE` while another monitor run
   *  holds the adapter). Holds the session (`exclusive`) meanwhile, so never
   *  call it from inside `withModule`. */
  listenBus(ms: number): Promise<string[]>;
}

/** Request headers of the excluded modules, so a caller that omits `address` is refused too. */
const EXCLUDED_REQ_HEADERS = new Set(
  VAG_UDS_HEADER_CANDIDATES.filter((c) =>
    (AGENT_EXCLUDED_MODULE_ADDRESSES as readonly string[]).includes(c.address),
  ).map((c) => c.reqHeader.toUpperCase()),
);

/** A CAN id as `ATSH` / `ATCRA` take it: 3 (11-bit) to 8 (29-bit) hex digits, nothing else — so a
 *  header string can never carry a second command to the adapter. */
const CAN_ID = /^[0-9A-F]{3,8}$/i;

/** The out-of-scope address `addr` targets (excluded module, or an id that is not a plain CAN id),
 *  or null when it is in scope. */
function excludedAddress(addr: ModuleAddress): string | null {
  if (
    !CAN_ID.test(addr.reqHeader) ||
    (addr.rxFilter !== undefined && !CAN_ID.test(addr.rxFilter))
  ) {
    return JSON.stringify(addr.address ?? addr.reqHeader);
  }
  const address = addr.address?.trim().toUpperCase();
  if (address && (AGENT_EXCLUDED_MODULE_ADDRESSES as readonly string[]).includes(address)) {
    return address;
  }
  const header = addr.reqHeader.toUpperCase();
  return EXCLUDED_REQ_HEADERS.has(header) ? (address ?? header) : null;
}

/** Send `cmd` through `send` only when it is a read request; otherwise reject before any traffic.
 *  With `ready`, an allowed request also waits for it (the module addressing) before going out. */
function guardedSend(send: UdsSend, ready?: Promise<void>): UdsSend {
  return async (cmd) => {
    if (!isReadOnlyRequest(cmd)) throw new WriteBlockedError(cmd);
    if (ready) await ready;
    return send(cmd);
  };
}

/** Wrap `session` in the read-only facade. A plain object literal closing over the session, so no
 *  write member (or the session itself) is reachable through it. */
export function createReadOnlySession(session: DiagnosticSession): ReadOnlySession {
  const send = guardedSend((cmd) => session.send(cmd));
  return {
    get currentProtocol() {
      return session.currentProtocol;
    },
    get supportedPids() {
      return session.supportedPids;
    },
    get canMonitor() {
      return session.canMonitor;
    },
    effectivePids: (profilePids) => session.effectivePids(profilePids),
    readValue: (pid) => session.readValue(pid),
    pollOnce: (pids) => session.pollOnce(pids),
    readDtcs: (kind) => session.readDtcs(kind),
    readReadiness: () => session.readReadiness(),
    readFreezeFrame: (pids) => session.readFreezeFrame(pids),
    readFreezeFrames: (pids, maxFrames) => session.readFreezeFrames(pids, maxFrames),
    readVin: () => session.readVin(),
    readCalibrationId: () => session.readCalibrationId(),
    readPartNumber: () => session.readPartNumber(),
    readExtended: (did) => session.readExtended(did),
    pollExtendedOnce: (dids) => session.pollExtendedOnce(dids),
    readMode06: (mid) => session.readMode06(mid),
    readMode05: (tid, sensor) => session.readMode05(tid, sensor),
    readIupr: () => session.readIupr(),
    voltage: () => session.client.voltage(),
    adapterVersion: () => session.client.version(),
    protocolNumber: () => session.client.protocolNumber(),
    request: send,
    withModule: async (addr, fn) => {
      const excluded = excludedAddress(addr);
      if (excluded !== null) throw new ModuleNotAllowedError(excluded);
      return session.exclusive(async () => {
        // The addressing goes out first; `fn` gets its `send` at once, and every request it makes
        // waits for the addressing, so nothing reaches the bus before the module's header is set.
        const addressed = (async () => {
          await session.setHeader(addr.reqHeader);
          if (addr.rxFilter) await session.setRxFilter(addr.rxFilter);
        })();
        // Handled here so a failure while `fn` is still running is never an unhandled rejection;
        // it still surfaces through the awaits below and through every `send`.
        addressed.catch(() => undefined);
        try {
          const result = await fn(guardedSend((cmd) => session.send(cmd), addressed));
          await addressed; // a failed addressing fails the block even when `fn` sent nothing
          return result;
        } finally {
          await addressed.catch(() => undefined);
          await session.resetAddressing();
        }
      });
    },
    listenBus: async (ms) => {
      if (!session.canMonitor) throw new Error(MONITOR_UNAVAILABLE_MESSAGE);
      if (!isCan(session.currentProtocol)) throw new Error(BUS_LISTEN_NEEDS_CAN_MESSAGE);
      // Someone else's monitor run (the sniffer screen) owns the channel: never join or stop it.
      if (session.sniffing) throw new Error(BUS_LISTEN_BUSY_MESSAGE);
      const window = Math.min(BUS_LISTEN_MAX_MS, Math.max(0, Number.isFinite(ms) ? ms : 0));
      return session.exclusive(async () => {
        const lines: string[] = [];
        try {
          await session.startSniffer((line) => {
            if (line.trim()) lines.push(line);
          });
          await new Promise((resolve) => setTimeout(resolve, window));
        } finally {
          await session.stopSniffer();
        }
        return lines;
      });
    },
  };
}
