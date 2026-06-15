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

function hex(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

function checkNegative(req: number, res: number[] | null): number[] {
  if (!res || res.length === 0) throw new UdsError('No response');
  if (res[0] === 0x7f) throw new UdsError(`Negative response (NRC 0x${(res[2] ?? 0).toString(16)})`, res[2]);
  const expected = req + 0x40;
  if (res[0] !== expected)
    throw new UdsError(`Unexpected response 0x${res[0].toString(16)} (wanted 0x${expected.toString(16)})`);
  return res;
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

/** 0x27 SecurityAccess seed/key. `seedToKey` is profile-supplied; none ship by default. */
export async function securityAccess(
  send: UdsSend,
  level: number,
  seedToKey: (seed: number[]) => number[],
): Promise<void> {
  const seedRes = checkNegative(0x27, await send('27' + hex([level])));
  const seed = seedRes.slice(2); // 0x67 <level> <seed...>
  if (seed.every((b) => b === 0)) return; // already unlocked
  const key = seedToKey(seed);
  checkNegative(0x27, await send('27' + hex([level + 1]) + hex(key)));
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
