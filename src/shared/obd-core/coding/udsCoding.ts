/** UDS coding sequence over an injectable byte sender. The whole read→backup→(security)→write→
 *  verify flow lives here so it is unit-testable with a fake sender (no hardware). The Diagnostic
 *  session supplies the real sender. SAFETY: see docs/features/coding.md — write is gated upstream. */

/** Sends a hex command (e.g. '221234'); resolves with the response bytes (service byte first), or
 *  null on NO DATA / notice. Negative responses (`7F ...`) are returned as bytes for parsing. */
export type UdsSend = (cmd: string) => Promise<number[] | null>;

export class UdsError extends Error {
  constructor(
    message: string,
    readonly nrc?: number,
  ) {
    super(message);
    this.name = 'UdsError';
  }
}

/** Format bytes as a compact hex string (shared by the UDS/KWP helpers). */
export function hexBytes(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

const hex = hexBytes;

/** ISO 14229 negative-response codes we can name. Kept small and diagnostic-focused: the ones a
 *  user actually hits driving coding / routines / adaptations. Anything else falls back to the raw
 *  hex. Used to turn `7F <svc> <nrc>` into a legible message instead of a bare code. */
const NRC_NAMES: Record<number, string> = {
  0x10: 'generalReject',
  0x11: 'serviceNotSupported',
  0x12: 'subFunctionNotSupported',
  0x13: 'incorrectMessageLengthOrInvalidFormat',
  0x14: 'responseTooLong',
  0x21: 'busyRepeatRequest',
  0x22: 'conditionsNotCorrect',
  0x24: 'requestSequenceError',
  0x31: 'requestOutOfRange',
  0x33: 'securityAccessDenied',
  0x35: 'invalidKey',
  0x36: 'exceedNumberOfAttempts',
  0x37: 'requiredTimeDelayNotExpired',
  0x70: 'uploadDownloadNotAccepted',
  0x72: 'generalProgrammingFailure',
  0x78: 'requestCorrectlyReceived-ResponsePending',
  0x7e: 'subFunctionNotSupportedInActiveSession',
  0x7f: 'serviceNotSupportedInActiveSession',
  0x92: 'voltageTooHigh',
  0x93: 'voltageTooLow',
};

/** Human name for an ISO 14229 negative-response code, or `null` if we don't have one. */
export function nrcName(nrc: number): string | null {
  return NRC_NAMES[nrc] ?? null;
}

/** NRC 0x78 requestCorrectlyReceived-ResponsePending. Slow operations (routine starts — DPF regen
 *  in particular — security access, DTC clears) answer `7F <svc> 78` one or more times before the
 *  final response; each repeat also keeps the ELM327's receive window open, so the real answer
 *  usually lands in the SAME response, after the echoes. Strip every leading echo. */
export function stripResponsePending(req: number, res: number[]): number[] {
  let out = res;
  while (out.length >= 3 && out[0] === 0x7f && out[1] === req && out[2] === 0x78) out = out.slice(3);
  return out;
}

/** Validate a UDS/KWP response for request service `req`: tolerate response-pending echoes, throw
 *  a UdsError on a negative or unexpected response, and return the (cleaned) positive response.
 *  The single implementation shared by udsCoding / udsModule / guidedRoutine. */
export function checkNegative(req: number, res: number[] | null): number[] {
  if (!res || res.length === 0) throw new UdsError('No response');
  const cleaned = stripResponsePending(req, res);
  if (cleaned.length === 0) {
    throw new UdsError(
      'Module is still processing (response pending) — no final answer arrived in time. ' +
        'Wait a moment and retry.',
      0x78,
    );
  }
  if (cleaned[0] === 0x7f) {
    const nrc = cleaned[2] ?? 0;
    const name = nrcName(nrc);
    throw new UdsError(
      `Negative response${name ? `: ${name}` : ''} (NRC 0x${nrc.toString(16).padStart(2, '0')})`,
      nrc,
    );
  }
  const expected = req + 0x40;
  if (cleaned[0] !== expected)
    throw new UdsError(
      `Unexpected response 0x${cleaned[0].toString(16)} (wanted 0x${expected.toString(16)})`,
    );
  return cleaned;
}

/** 0x10 DiagnosticSessionControl — enter the given session (default 0x03 extended). */
export async function enterSession(send: UdsSend, session = 0x03): Promise<void> {
  const res = await send('10' + hex([session]));
  checkNegative(0x10, res);
}

/** 0x3E TesterPresent keep-alive. */
export async function testerPresent(send: UdsSend): Promise<void> {
  await send('3E00');
}

/** 0x22 ReadDataByIdentifier — returns the data bytes after the echoed DID. */
export async function readDataByIdentifier(send: UdsSend, did: string): Promise<number[]> {
  const res = checkNegative(0x22, await send('22' + did));
  return res.slice(1 + did.length / 2); // drop 0x62 + DID echo
}

/** 0x2E WriteDataByIdentifier. Resolves on the positive `0x6E <did>` ack. */
export async function writeDataByIdentifier(
  send: UdsSend,
  did: string,
  data: number[],
): Promise<void> {
  checkNegative(0x2e, await send('2E' + did + hex(data)));
}

/** 0x27 SecurityAccess seed/key. `seedToKey` is profile-supplied; none ship by default.
 *  NRC 0x37 (requiredTimeDelayNotExpired) — the post-boot / post-failed-attempt lockout most VAG
 *  modules enforce — is retried once after `retryDelayMs`. NRC 0x36 (exceedNumberOfAttempts) is
 *  NOT retried: hammering a locked module only extends the lockout. */
export async function securityAccess(
  send: UdsSend,
  level: number,
  seedToKey: (seed: number[]) => number[],
  opts: { retryDelayMs?: number } = {},
): Promise<void> {
  const attempt = async (): Promise<void> => {
    const seedRes = checkNegative(0x27, await send('27' + hex([level])));
    const seed = seedRes.slice(2); // 0x67 <level> <seed...>
    if (seed.every((b) => b === 0)) return; // already unlocked
    const key = seedToKey(seed);
    checkNegative(0x27, await send('27' + hex([level + 1]) + hex(key)));
  };
  try {
    await attempt();
  } catch (e) {
    if (e instanceof UdsError && e.nrc === 0x37) {
      await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 1100));
      await attempt();
    } else {
      throw e;
    }
  }
}

export interface CodeModuleOptions {
  did: string;
  newData: number[];
  session?: number;
  security?: { level: number; seedToKey: (seed: number[]) => number[] };
}

export interface CodeModuleResult {
  backup: number[];
  written: number[];
  verified: boolean;
}

/** The full guarded flow: read current (backup) → extended session → optional security → write →
 *  re-read & verify. Throws UdsError on any failure (caller keeps the backup for restore). */
export async function codeModule(send: UdsSend, opts: CodeModuleOptions): Promise<CodeModuleResult> {
  const backup = await readDataByIdentifier(send, opts.did);
  await enterSession(send, opts.session ?? 0x03);
  if (opts.security) await securityAccess(send, opts.security.level, opts.security.seedToKey);
  await writeDataByIdentifier(send, opts.did, opts.newData);
  const after = await readDataByIdentifier(send, opts.did);
  const verified = after.length === opts.newData.length && after.every((b, i) => b === opts.newData[i]);
  return { backup, written: after, verified };
}


/** 0x31 RoutineControl. `sub` is 0x01 start / 0x02 stop / 0x03 requestResults. Returns the response
 *  bytes (positive 0x71 ...). */
export async function routineControl(
  send: UdsSend,
  sub: number,
  routineId: string,
  data: number[] = [],
): Promise<number[]> {
  return checkNegative(0x31, await send('31' + hex([sub]) + routineId + hex(data)));
}

/** True when an error message means "the module never answered" (as opposed to a negative response
 *  or a genuine protocol error): No response / NO DATA / timeouts ("timeout", "timed out") /
 *  UNABLE TO CONNECT / BUS INIT ERROR. Used to explain unreachable modules honestly (a generic
 *  ELM327 cannot address e.g. a KWP1281 instrument cluster — see docs/features/service-reset.md). */
export function isModuleUnreachableError(message: string): boolean {
  return /no response|no data|timed?\s?-?\s?out|unable\s*to\s*connect|bus\s*init/i.test(message);
}

export interface ServiceResetDescriptor {
  transport?: 'uds' | 'kwp';
  method: 'routine' | 'adaptation';
  routineId?: string;
  adaptations?: { did: string; defaultBytes: number[] }[];
  session?: number;
  security?: { level: number; seedToKey: (seed: number[]) => number[] };
}

export interface ServiceResetResult {
  method: 'routine' | 'adaptation';
  backups: { did: string; bytes: number[] }[];
  ok: boolean;
}


/** KWP2000 (ISO 14230) StartRoutineByLocalIdentifier: `31 <lid>` -> positive `71`. */
export async function kwpStartRoutine(send: UdsSend, lid: string): Promise<number[]> {
  return checkNegative(0x31, await send('31' + lid));
}

/** KWP2000 ReadDataByLocalIdentifier: `21 <lid>` -> `61 <lid> <data>`. */
export async function kwpReadLocal(send: UdsSend, lid: string): Promise<number[]> {
  const res = checkNegative(0x21, await send('21' + lid));
  return res.slice(1 + lid.length / 2);
}

/** KWP2000 WriteDataByLocalIdentifier: `3B <lid> <data>` -> positive `7B`. */
export async function kwpWriteLocal(send: UdsSend, lid: string, data: number[]): Promise<void> {
  checkNegative(0x3b, await send('3B' + lid + hex(data)));
}

async function serviceResetKwp(
  send: UdsSend,
  descriptor: ServiceResetDescriptor,
): Promise<ServiceResetResult> {
  // KWP cars: start a diagnostic session (default 0x85), optional login, then routine/adaptation.
  await enterSession(send, descriptor.session ?? 0x85);
  if (descriptor.security)
    await securityAccess(send, descriptor.security.level, descriptor.security.seedToKey);

  if (descriptor.method === 'routine') {
    if (!descriptor.routineId) throw new UdsError('No routineId for KWP routine reset');
    await kwpStartRoutine(send, descriptor.routineId);
    return { method: 'routine', backups: [], ok: true };
  }

  const backups: { did: string; bytes: number[] }[] = [];
  for (const a of descriptor.adaptations ?? []) {
    backups.push({ did: a.did, bytes: await kwpReadLocal(send, a.did) });
    await kwpWriteLocal(send, a.did, a.defaultBytes);
  }
  return { method: 'adaptation', backups, ok: true };
}

/** Reset the service interval: extended session -> optional security -> a manufacturer routine
 *  (RoutineControl) or writing the service adaptation value(s) back to default (with a backup).
 *  Throws UdsError on any failure. SAFETY: gated upstream — see docs/features/service-reset.md. */
export async function serviceReset(
  send: UdsSend,
  descriptor: ServiceResetDescriptor,
): Promise<ServiceResetResult> {
  if ((descriptor.transport ?? 'uds') === 'kwp') return serviceResetKwp(send, descriptor);
  await enterSession(send, descriptor.session ?? 0x03);
  if (descriptor.security)
    await securityAccess(send, descriptor.security.level, descriptor.security.seedToKey);

  if (descriptor.method === 'routine') {
    if (!descriptor.routineId) throw new UdsError('No routineId for routine reset');
    await routineControl(send, 0x01, descriptor.routineId);
    return { method: 'routine', backups: [], ok: true };
  }

  const backups: { did: string; bytes: number[] }[] = [];
  for (const a of descriptor.adaptations ?? []) {
    backups.push({ did: a.did, bytes: await readDataByIdentifier(send, a.did) });
    await writeDataByIdentifier(send, a.did, a.defaultBytes);
  }
  return { method: 'adaptation', backups, ok: true };
}
