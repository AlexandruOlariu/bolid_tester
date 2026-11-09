/** Capture analyzer (plan 25): turns a sniffer CSV (plan 03 format) into ISO-TP messages,
 *  request/response pairs with UDS / KWP2000 decoding, request "fingerprints" and a TP2.0 summary —
 *  so the real routine bytes VCDS sends can be read off a capture in minutes.
 *
 *  SELF-CONTAINED ON PURPOSE: no imports, and only erasable TypeScript (interfaces, annotations), so
 *  `scripts/analyze-capture.mjs` can run this file directly with Node's type stripping
 *  (Node >= 22.18 / 24 / 25) while jest tests it like any core module. Do not add imports here.
 *
 *  Input frames carry the ISO-TP PCI byte: the sniffer records `ATMA` with headers on (`ATH1`),
 *  which makes the ELM327 print every data byte of the frame. See docs/captures/README.md. */

export interface CaptureFrame {
  tMs: number;
  /** CAN id as printed ('7E0', '200', '18DAF110'); '' when headers were off. */
  id: string;
  dlc: number;
  bytes: number[];
}

export interface CaptureFile {
  /** `# key: value` header lines (vehicle, protocol, adapter, started, note, …). */
  header: Record<string, string>;
  frames: CaptureFrame[];
  /** The trailing `# raw:` block (lines that did not parse as frames) plus any malformed row. */
  rawLines: string[];
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
const hexBytes = (bytes: number[]): string => bytes.map(hex2).join(' ');
const hexWord = (bytes: number[]): string => bytes.map(hex2).join('');

/** Parse a plan-03 capture CSV: `# key: value` header comments, a `t_ms,id,dlc,bytes` header row,
 *  one row per frame (space-separated hex), then an optional `# raw:` block (`# <t_ms>\t<line>`).
 *  Tolerant: CRLF or LF, blank lines, and a malformed row goes to `rawLines` instead of throwing. */
export function parseCaptureCsv(text: string): CaptureFile {
  const header: Record<string, string> = {};
  const frames: CaptureFrame[] = [];
  const rawLines: string[] = [];
  let inRaw = false;
  for (const line0 of text.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const body = line.slice(1).trim();
      if (inRaw) {
        rawLines.push(body);
        continue;
      }
      if (/^raw:/i.test(body)) {
        inRaw = true;
        continue;
      }
      const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(body);
      if (m) header[m[1]] = m[2];
      continue;
    }
    if (/^t_ms\s*,/i.test(line)) continue;
    const parts = line.split(',');
    const tMs = Number(parts[0]);
    const hex = (parts[3] ?? '').trim();
    const bytes = hex
      ? hex.split(/\s+/).map((b) => (/^[0-9A-Fa-f]{2}$/.test(b) ? parseInt(b, 16) : NaN))
      : [];
    if (parts.length < 4 || !Number.isFinite(tMs) || bytes.some((b) => Number.isNaN(b))) {
      rawLines.push(line);
      continue;
    }
    const dlc = Number(parts[2]);
    frames.push({
      tMs,
      id: parts[1].trim().toUpperCase(),
      dlc: Number.isFinite(dlc) ? dlc : bytes.length,
      bytes,
    });
  }
  return { header, frames, rawLines };
}

export interface IsoTpMessage {
  id: string;
  tStartMs: number;
  tEndMs: number;
  /** The reassembled payload (service byte first). */
  bytes: number[];
  /** CAN frames it took (1 for a single frame). */
  frames: number;
  /** The id that sent the flow-control frame for this multi-frame message. */
  flowControlFrom?: string;
  /** A multi-frame message that ended early (missing / out-of-order consecutive frame). */
  truncated?: boolean;
  /** The payload after the service byte was dropped because it is a secret (a KWP `2B` login
   *  code); `bytes` then holds the service byte only. Set by `analyzeCapture`. */
  redacted?: boolean;
}

interface PendingMessage {
  id: string;
  tStartMs: number;
  tEndMs: number;
  expected: number;
  bytes: number[];
  frames: number;
  nextSeq: number;
  flowControlFrom?: string;
}

/** Reassemble raw ISO-TP (ISO 15765-2) frames per CAN id: PCI 0 single frame, 1 first frame, 2
 *  consecutive frame (sequence checked), 3 flow control — attached to the newest open multi-frame
 *  message of ANOTHER id (the stream it controls). Frames that are not valid ISO-TP are ignored.
 *  This is the raw-frame counterpart of `elm327/responseParser.reassembleIsoTp`, which reassembles
 *  the ELM327's own multi-line printout. Output is ordered by start time. */
export function reassembleCaptureIsoTp(frames: CaptureFrame[]): IsoTpMessage[] {
  const out: IsoTpMessage[] = [];
  const open = new Map<string, PendingMessage>();
  const finish = (p: PendingMessage, truncated: boolean) => {
    open.delete(p.id);
    out.push({
      id: p.id,
      tStartMs: p.tStartMs,
      tEndMs: p.tEndMs,
      bytes: truncated ? p.bytes.slice() : p.bytes.slice(0, p.expected),
      frames: p.frames,
      ...(p.flowControlFrom ? { flowControlFrom: p.flowControlFrom } : {}),
      ...(truncated ? { truncated: true } : {}),
    });
  };
  for (const f of frames) {
    const b = f.bytes;
    if (!b.length) continue;
    const pci = b[0] >> 4;
    if (pci === 0) {
      let len = b[0] & 0x0f;
      let start = 1;
      if (len === 0 && b.length > 2) {
        len = b[1]; // CAN-FD escape: length in the second byte
        start = 2;
      }
      if (len === 0 || len > b.length - start) continue;
      const prev = open.get(f.id);
      if (prev) finish(prev, true);
      out.push({
        id: f.id,
        tStartMs: f.tMs,
        tEndMs: f.tMs,
        bytes: b.slice(start, start + len),
        frames: 1,
      });
    } else if (pci === 1) {
      if (b.length < 2) continue;
      const expected = ((b[0] & 0x0f) << 8) | b[1];
      if (expected < 8) continue;
      const prev = open.get(f.id);
      if (prev) finish(prev, true);
      open.set(f.id, {
        id: f.id,
        tStartMs: f.tMs,
        tEndMs: f.tMs,
        expected,
        bytes: b.slice(2),
        frames: 1,
        nextSeq: 1,
      });
    } else if (pci === 2) {
      const p = open.get(f.id);
      if (!p) continue;
      if ((b[0] & 0x0f) !== (p.nextSeq & 0x0f)) {
        finish(p, true);
        continue;
      }
      p.bytes.push(...b.slice(1));
      p.frames += 1;
      p.nextSeq += 1;
      p.tEndMs = f.tMs;
      if (p.bytes.length >= p.expected) finish(p, false);
    } else if (pci === 3) {
      let target: PendingMessage | null = null;
      for (const p of open.values()) {
        if (p.id === f.id || p.flowControlFrom) continue;
        if (!target || p.tStartMs >= target.tStartMs) target = p;
      }
      if (target) target.flowControlFrom = f.id;
    }
  }
  for (const p of [...open.values()]) finish(p, true);
  return out.sort((a, c) => a.tStartMs - c.tStartMs);
}

export interface UdsDecoded {
  /** The first byte as sent (0x31 request, 0x71 positive, 0x7F negative). */
  sid: number;
  /** The service the message belongs to (0x31 for 31 / 71 / 7F 31). */
  service: number;
  name: string;
  kind: 'request' | 'positive' | 'negative' | 'unknown';
  sub?: number;
  /** Data identifier (4 hex) for 22 / 2E / 2F, local identifier (2 hex) for KWP 21 / 3B / 30 / 1A. */
  did?: string;
  /** RoutineControl (31) routine id, 4 hex. */
  routineId?: string;
  nrc?: number;
  nrcName?: string;
  summary: string;
}

/** UDS (ISO 14229) and the KWP2000 (ISO 14230) services VAG tools use, by request SID. */
const SERVICES: Record<number, string> = {
  0x10: 'DiagnosticSessionControl',
  0x11: 'ECUReset',
  0x14: 'ClearDiagnosticInformation',
  0x18: 'ReadDTCByStatus (KWP)',
  0x19: 'ReadDTCInformation',
  0x1a: 'ReadECUIdentification (KWP)',
  0x21: 'ReadDataByLocalIdentifier (KWP)',
  0x22: 'ReadDataByIdentifier',
  0x23: 'ReadMemoryByAddress',
  0x27: 'SecurityAccess',
  0x2b: 'Login (KWP)',
  0x2e: 'WriteDataByIdentifier',
  0x2f: 'InputOutputControlByIdentifier',
  0x30: 'InputOutputControlByLocalIdentifier (KWP)',
  0x31: 'RoutineControl',
  0x3b: 'WriteDataByLocalIdentifier (KWP)',
  0x3e: 'TesterPresent',
};

/** Services whose second byte is a sub-function. */
const WITH_SUB = new Set([0x10, 0x11, 0x19, 0x27, 0x31, 0x3e]);
/** Services addressed by a 2-byte data identifier after the SID. */
const WITH_DID = new Set([0x22, 0x2e, 0x2f]);
/** KWP services addressed by a 1-byte local identifier. */
const WITH_LID = new Set([0x1a, 0x21, 0x30, 0x3b]);

const SUB_NAMES: Record<number, Record<number, string>> = {
  0x10: { 0x01: 'default', 0x02: 'programming', 0x03: 'extended', 0x89: 'KWP extended' },
  0x31: { 0x01: 'start', 0x02: 'stop', 0x03: 'results' },
  0x11: { 0x01: 'hard reset', 0x02: 'key off/on', 0x03: 'soft reset' },
};

/** ISO 14229-1 negative response codes. */
const NRC_NAMES: Record<number, string> = {
  0x10: 'generalReject',
  0x11: 'serviceNotSupported',
  0x12: 'subFunctionNotSupported',
  0x13: 'incorrectMessageLengthOrInvalidFormat',
  0x14: 'responseTooLong',
  0x21: 'busyRepeatRequest',
  0x22: 'conditionsNotCorrect',
  0x24: 'requestSequenceError',
  0x25: 'noResponseFromSubnetComponent',
  0x26: 'failurePreventsExecutionOfRequestedAction',
  0x31: 'requestOutOfRange',
  0x33: 'securityAccessDenied',
  0x35: 'invalidKey',
  0x36: 'exceededNumberOfAttempts',
  0x37: 'requiredTimeDelayNotExpired',
  0x70: 'uploadDownloadNotAccepted',
  0x71: 'transferDataSuspended',
  0x72: 'generalProgrammingFailure',
  0x73: 'wrongBlockSequenceCounter',
  0x78: 'requestCorrectlyReceivedResponsePending',
  0x7e: 'subFunctionNotSupportedInActiveSession',
  0x7f: 'serviceNotSupportedInActiveSession',
  0x81: 'rpmTooHigh',
  0x82: 'rpmTooLow',
  0x83: 'engineIsRunning',
  0x84: 'engineIsNotRunning',
  0x85: 'engineRunTimeTooLow',
  0x86: 'temperatureTooHigh',
  0x87: 'temperatureTooLow',
  0x88: 'vehicleSpeedTooHigh',
  0x89: 'vehicleSpeedTooLow',
  0x8a: 'throttlePedalTooHigh',
  0x8b: 'throttlePedalTooLow',
  0x8c: 'transmissionRangeNotInNeutral',
  0x8d: 'transmissionRangeNotInGear',
  0x8f: 'brakeSwitchNotClosed',
  0x90: 'shifterLeverNotInPark',
  0x91: 'torqueConverterClutchLocked',
  0x92: 'voltageTooHigh',
  0x93: 'voltageTooLow',
};

const NRC_RESPONSE_PENDING = 0x78;

/** Requests whose payload is a secret: KWP `2B` Login carries the module's login code. */
const isSecretRequest = (d: UdsDecoded): boolean => d.kind === 'request' && d.service === 0x2b;

/** A copy of a secret request with everything after the service byte dropped. */
function redactSecret(m: IsoTpMessage): IsoTpMessage {
  return { ...m, bytes: m.bytes.slice(0, 1), redacted: true };
}

/** Decode one reassembled UDS / KWP2000 message (service byte first). */
export function decodeUds(bytes: number[]): UdsDecoded {
  if (!bytes.length)
    return { sid: -1, service: -1, name: 'empty', kind: 'unknown', summary: '(empty)' };
  const b0 = bytes[0];
  if (b0 === 0x7f && bytes.length >= 3) {
    const service = bytes[1];
    const nrc = bytes[2];
    const nrcName = NRC_NAMES[nrc] ?? `nrc 0x${hex2(nrc)}`;
    const name = SERVICES[service] ?? `service ${hex2(service)}`;
    return {
      sid: b0,
      service,
      name,
      kind: 'negative',
      nrc,
      nrcName,
      summary: `Negative ${name} (${hex2(service)}): ${nrcName} (0x${hex2(nrc)})`,
    };
  }
  let kind: UdsDecoded['kind'];
  let service: number;
  if (SERVICES[b0]) {
    kind = 'request';
    service = b0;
  } else if (b0 >= 0x40 && SERVICES[b0 - 0x40]) {
    kind = 'positive';
    service = b0 - 0x40;
  } else {
    return {
      sid: b0,
      service: b0,
      name: `unknown ${hex2(b0)}`,
      kind: 'unknown',
      summary: hexBytes(bytes),
    };
  }
  const name = SERVICES[service];
  const out: UdsDecoded = { sid: b0, service, name, kind, summary: '' };
  const parts: string[] = [kind === 'positive' ? `${name} +` : name];
  if (WITH_SUB.has(service) && bytes.length >= 2) {
    out.sub = bytes[1];
    const subName = SUB_NAMES[service]?.[bytes[1] & 0x7f];
    parts.push(`${hex2(bytes[1])}${subName ? ` (${subName})` : ''}`);
    if (service === 0x31 && bytes.length >= 4) {
      out.routineId = hexWord(bytes.slice(2, 4));
      parts.push(`routine ${out.routineId}`);
    }
    if (service === 0x27) parts.push(bytes[1] % 2 === 1 ? 'request seed' : 'send key');
  } else if (WITH_DID.has(service) && bytes.length >= 3) {
    out.did = hexWord(bytes.slice(1, 3));
    parts.push(`DID ${out.did}`);
    if (service === 0x22 && kind === 'request' && bytes.length >= 5) {
      parts.push(`(+${Math.floor((bytes.length - 3) / 2)} more DID)`);
    }
  } else if (WITH_LID.has(service) && bytes.length >= 2) {
    out.did = hex2(bytes[1]);
    parts.push(service === 0x1a ? `option ${out.did}` : `local id ${out.did}`);
  } else if (service === 0x2b && kind === 'request') {
    parts.push('(login code not shown)');
  }
  const dataStart = out.routineId
    ? 4
    : out.did
      ? out.did.length === 4
        ? 3
        : 2
      : out.sub !== undefined
        ? 2
        : 1;
  const data = bytes.slice(dataStart);
  // A login request's payload is the module's login code — never echo it.
  if (data.length && !(service === 0x2b && kind === 'request'))
    parts.push(`data ${hexBytes(data)}`);
  out.summary = parts.join(' ');
  return out;
}

export interface RequestResponsePair {
  request: IsoTpMessage;
  response: IsoTpMessage | null;
  decodedRequest: UdsDecoded;
  decodedResponse: UdsDecoded | null;
  /** Request end → response start, or null when unanswered. */
  latencyMs: number | null;
  /** `7F <sid> 78` "response pending" replies seen before the final answer. */
  pending?: number;
}

/** Pair each request with its answer: the next message from a DIFFERENT id whose SID is the
 *  request SID + 0x40 or `7F <request SID>`, within `windowMs` (default 2000) of the request (or of
 *  the last "response pending"). The search stops when the requester sends its next request
 *  (e.g. a `3E 80` that suppresses its reply). Each response is used once. */
export function pairRequests(
  messages: IsoTpMessage[],
  opts: { windowMs?: number } = {},
): RequestResponsePair[] {
  const windowMs = opts.windowMs ?? 2000;
  const decoded = messages.map((m) => decodeUds(m.bytes));
  const used = new Set<number>();
  const pairs: RequestResponsePair[] = [];
  for (let i = 0; i < messages.length; i++) {
    const dq = decoded[i];
    if (dq.kind !== 'request') continue;
    const req = messages[i];
    let response: IsoTpMessage | null = null;
    let decodedResponse: UdsDecoded | null = null;
    let pending = 0;
    let since = req.tEndMs;
    for (let j = i + 1; j < messages.length; j++) {
      const m = messages[j];
      if (m.tStartMs - since > windowMs) break;
      const d = decoded[j];
      if (m.id === req.id) {
        if (d.kind === 'request') break;
        continue;
      }
      if (used.has(j) || d.service !== dq.service) continue;
      if (d.kind === 'negative' && d.nrc === NRC_RESPONSE_PENDING) {
        used.add(j);
        pending += 1;
        since = m.tEndMs;
        continue;
      }
      if (d.kind === 'positive' || d.kind === 'negative') {
        used.add(j);
        response = m;
        decodedResponse = d;
        break;
      }
    }
    pairs.push({
      request: req,
      response,
      decodedRequest: dq,
      decodedResponse,
      latencyMs: response ? response.tStartMs - req.tEndMs : null,
      ...(pending ? { pending } : {}),
    });
  }
  return pairs;
}

export interface Tp20Summary {
  /** Channel setup requests (`0x200`, opcode C0); `target` = the logical module address. */
  setupRequests: { tMs: number; id: string; target: number; bytes: number[] }[];
  /** Setup responses (`0x201`–`0x2FF`, opcode D0 positive or D1–D8 negative). */
  setupResponses: { tMs: number; id: string; bytes: number[] }[];
  /** Data-channel ids (negotiated in a setup response, in 0x300–0x3FF, or a 0x600–0x7FF id that
   *  carries a TP2.0-only opcode) with frame counts and channel-test (`A3`) keep-alives. */
  dataChannels: { id: string; frames: number; keepAlives: number }[];
}

const idNum = (id: string): number => (/^[0-9A-F]{3}$/i.test(id) ? parseInt(id, 16) : -1);
const idStr = (n: number): string => n.toString(16).padStart(3, '0').toUpperCase();

/** A first byte only a TP2.0 data channel sends: `A0`/`A1` channel parameters, `A3` channel test,
 *  `A4` break, `A8` disconnect, `9x` ACK-not-ready, `Bx` ACK. ISO-TP never sends these (its PCI
 *  nibble is 0–3), so one such frame marks the id as a TP2.0 channel. */
const isTp20Opcode = (b0: number | undefined): boolean =>
  b0 !== undefined &&
  (b0 >> 4 === 0x9 ||
    b0 >> 4 === 0xb ||
    b0 === 0xa0 ||
    b0 === 0xa1 ||
    b0 === 0xa3 ||
    b0 === 0xa4 ||
    b0 === 0xa8);

/** Summarize VW TP2.0 traffic: channel setups on 0x200, their answers on 0x200 + module address,
 *  and the data channels with their `A3` keep-alive counts. A channel id comes from a D0 answer
 *  (bytes 2-3 the module's tx id, 4-5 the tester's), from 0x300–0x3FF, or — for a capture trimmed
 *  past the channel setup — from a 0x600–0x7FF id (e.g. the tester's 0x740) that sends a
 *  TP2.0-only opcode (`isTp20Opcode`). */
export function summarizeTp20(frames: CaptureFrame[]): Tp20Summary {
  const setupRequests: Tp20Summary['setupRequests'] = [];
  const setupResponses: Tp20Summary['setupResponses'] = [];
  const channelIds = new Set<number>();
  for (const f of frames) {
    const n = idNum(f.id);
    if (n === 0x200 && f.bytes.length >= 2 && f.bytes[1] === 0xc0) {
      setupRequests.push({ tMs: f.tMs, id: f.id, target: f.bytes[0], bytes: f.bytes.slice() });
    } else if (n >= 0x200 && n <= 0x2ff && f.bytes.length >= 2 && (f.bytes[1] & 0xf0) === 0xd0) {
      setupResponses.push({ tMs: f.tMs, id: f.id, bytes: f.bytes.slice() });
      if (f.bytes[1] === 0xd0 && f.bytes.length >= 6) {
        const valid = (hi: number) => (hi & 0x10) === 0;
        if (valid(f.bytes[3])) channelIds.add(f.bytes[2] | ((f.bytes[3] & 0x07) << 8));
        if (valid(f.bytes[5])) channelIds.add(f.bytes[4] | ((f.bytes[5] & 0x07) << 8));
      }
    }
  }
  for (const f of frames) {
    const n = idNum(f.id);
    if (n >= 0x600 && n <= 0x7ff && isTp20Opcode(f.bytes[0])) channelIds.add(n);
  }
  const stats = new Map<number, { frames: number; keepAlives: number }>();
  for (const f of frames) {
    const n = idNum(f.id);
    if (!channelIds.has(n) && !(n >= 0x300 && n <= 0x3ff)) continue;
    const s = stats.get(n) ?? { frames: 0, keepAlives: 0 };
    s.frames += 1;
    if (f.bytes[0] === 0xa3) s.keepAlives += 1;
    stats.set(n, s);
  }
  const dataChannels = [...stats.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, s]) => ({ id: idStr(n), ...s }));
  return { setupRequests, setupResponses, dataChannels };
}

/** True for ids diagnostic traffic uses: 11-bit 0x600–0x7FF, 29-bit 18DAxxxx / 18DBxxxx. */
function isDiagId(id: string): boolean {
  if (/^18D[AB]/i.test(id)) return true;
  const n = idNum(id);
  return n >= 0x600 && n <= 0x7ff;
}

export interface CaptureFingerprint {
  /** SID + sub + DID / routine id, e.g. '31 01 0301', '2F 0130', '22 F187'. */
  key: string;
  count: number;
  firstMs: number;
  lastMs: number;
  /** First occurrence: '7E0 31 01 03 01 → 71 01 03 01'. */
  example: string;
}

export interface CaptureReport {
  header: Record<string, string>;
  durationMs: number;
  frameCount: number;
  ids: { id: string; frames: number; firstMs: number; lastMs: number }[];
  pairs: RequestResponsePair[];
  fingerprints: CaptureFingerprint[];
  tp20: Tp20Summary;
  /** What the report was narrowed to (CLI `--around` / `--window` / `--id`). */
  filter: { aroundMs?: number; windowMs?: number; onlyId?: string };
}

/** Fingerprint key of a decoded request: SID, then sub-function, then routine id / DID. */
export function fingerprintKey(d: UdsDecoded): string {
  const parts = [hex2(d.service)];
  if (d.sub !== undefined) parts.push(hex2(d.sub));
  if (d.routineId) parts.push(d.routineId);
  else if (d.did) parts.push(d.did);
  return parts.join(' ');
}

/** The full analysis of one capture. `aroundMs` + `windowMs` (default 5000) keep only requests
 *  within ±window of that time; `onlyId` keeps pairs whose request or response is on that id;
 *  `pairWindowMs` is the request → response window (default 2000); `allIds` also reassembles
 *  non-diagnostic ids (by default only 0x600–0x7FF and 18DA/18DB are treated as ISO-TP). TP2.0
 *  traffic (every id `summarizeTp20` counts as a channel, setup or not) is summarized separately
 *  and never parsed as ISO-TP. */
export function analyzeCapture(
  file: CaptureFile,
  opts: {
    aroundMs?: number;
    windowMs?: number;
    onlyId?: string;
    pairWindowMs?: number;
    allIds?: boolean;
  } = {},
): CaptureReport {
  const frames = file.frames.slice().sort((a, b) => a.tMs - b.tMs);
  const idStats = new Map<string, { frames: number; firstMs: number; lastMs: number }>();
  for (const f of frames) {
    const key = f.id || '(no id)';
    const s = idStats.get(key);
    if (s) {
      s.frames += 1;
      s.lastMs = f.tMs;
    } else idStats.set(key, { frames: 1, firstMs: f.tMs, lastMs: f.tMs });
  }
  const tp20 = summarizeTp20(frames);
  const tp20Ids = new Set(tp20.dataChannels.map((c) => c.id));
  const isoFrames = frames.filter((f) => {
    if (!f.id || tp20Ids.has(f.id)) return false;
    const n = idNum(f.id);
    if (n >= 0x200 && n <= 0x2ff) return false;
    return opts.allIds ? true : isDiagId(f.id);
  });
  // A login code must never reach the report (Markdown example or `--json` bytes): the report is
  // meant to be pasted into vehicle docs that get committed.
  let pairs = pairRequests(reassembleCaptureIsoTp(isoFrames), {
    windowMs: opts.pairWindowMs,
  }).map((p) =>
    isSecretRequest(p.decodedRequest) ? { ...p, request: redactSecret(p.request) } : p,
  );
  const filter: CaptureReport['filter'] = {};
  if (opts.aroundMs !== undefined) {
    const around = opts.aroundMs;
    const w = opts.windowMs ?? 5000;
    filter.aroundMs = around;
    filter.windowMs = w;
    pairs = pairs.filter((p) => Math.abs(p.request.tStartMs - around) <= w);
  }
  if (opts.onlyId) {
    const id = opts.onlyId.toUpperCase();
    filter.onlyId = id;
    pairs = pairs.filter((p) => p.request.id === id || p.response?.id === id);
  }
  const fps = new Map<string, CaptureFingerprint>();
  for (const p of pairs) {
    const key = fingerprintKey(p.decodedRequest);
    const fp = fps.get(key);
    if (fp) {
      fp.count += 1;
      fp.lastMs = p.request.tStartMs;
    } else {
      fps.set(key, {
        key,
        count: 1,
        firstMs: p.request.tStartMs,
        lastMs: p.request.tStartMs,
        example:
          `${p.request.id} ${hexBytes(p.request.bytes)}` +
          (p.request.redacted ? ' (login code not shown)' : '') +
          (p.response ? ` → ${hexBytes(p.response.bytes)}` : ' → (no answer)'),
      });
    }
  }
  return {
    header: { ...file.header },
    durationMs: frames.length ? frames[frames.length - 1].tMs - frames[0].tMs : 0,
    frameCount: frames.length,
    ids: [...idStats.entries()]
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.frames - a.frames || a.id.localeCompare(b.id)),
    pairs,
    fingerprints: [...fps.values()].sort((a, b) => a.firstMs - b.firstMs),
    tp20,
    filter,
  };
}

const cell = (s: string): string => s.replace(/\|/g, '\\|');

/** The report as Markdown, for the terminal or pasting into a vehicle doc. */
export function renderReportMarkdown(report: CaptureReport): string {
  const h = report.header;
  const out: string[] = ['# Capture analysis', ''];
  for (const k of ['vehicle', 'protocol', 'adapter', 'started', 'note']) {
    if (h[k]) out.push(`- **${k}**: ${h[k]}`);
  }
  out.push(
    `- **frames**: ${report.frameCount} on ${report.ids.length} ids over ${(report.durationMs / 1000).toFixed(1)} s`,
  );
  const f = report.filter;
  if (f.aroundMs !== undefined) out.push(`- **window**: ${f.aroundMs} ms ± ${f.windowMs} ms`);
  if (f.onlyId) out.push(`- **id**: ${f.onlyId}`);
  out.push('', '## Fingerprints', '');
  if (report.fingerprints.length) {
    out.push(
      '| Request | Count | First ms | Last ms | Example |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const fp of report.fingerprints) {
      out.push(
        `| \`${fp.key}\` | ${fp.count} | ${fp.firstMs} | ${fp.lastMs} | \`${cell(fp.example)}\` |`,
      );
    }
  } else out.push('_No diagnostic requests found._');
  out.push('', '## Requests and responses', '');
  if (report.pairs.length) {
    out.push('| t ms | Id | Request | Response | Latency ms |', '| --- | --- | --- | --- | --- |');
    for (const p of report.pairs) {
      const resp = p.decodedResponse
        ? `${p.response?.id} ${p.decodedResponse.summary}${p.pending ? ` (after ${p.pending} × pending)` : ''}`
        : '(no answer)';
      const trunc = p.request.truncated || p.response?.truncated ? ' (truncated)' : '';
      out.push(
        `| ${p.request.tStartMs} | ${p.request.id} | ${cell(p.decodedRequest.summary)} | ${cell(resp)}${trunc} | ${p.latencyMs ?? '—'} |`,
      );
    }
  } else out.push('_None._');
  const t = report.tp20;
  out.push('', '## TP2.0', '');
  if (!t.setupRequests.length && !t.setupResponses.length && !t.dataChannels.length) {
    out.push('_No TP2.0 traffic._');
  } else {
    out.push(
      `- Channel setup: ${t.setupRequests.length} request(s), ${t.setupResponses.length} response(s)`,
    );
    for (const r of t.setupRequests) {
      out.push(`  - ${r.tMs} ms → module 0x${hex2(r.target)}: \`${r.id} ${hexBytes(r.bytes)}\``);
    }
    for (const r of t.setupResponses)
      out.push(`  - ${r.tMs} ms ← \`${r.id} ${hexBytes(r.bytes)}\``);
    const keepAlives = t.dataChannels.reduce((n, c) => n + c.keepAlives, 0);
    out.push(`- Keep-alives (A3): ${keepAlives}`);
    for (const c of t.dataChannels) {
      out.push(`  - channel ${c.id}: ${c.frames} frame(s), ${c.keepAlives} keep-alive(s)`);
    }
  }
  out.push(
    '',
    '## CAN ids',
    '',
    '| Id | Frames | First ms | Last ms |',
    '| --- | --- | --- | --- |',
  );
  for (const i of report.ids) out.push(`| ${i.id} | ${i.frames} | ${i.firstMs} | ${i.lastMs} |`);
  return out.join('\n') + '\n';
}
