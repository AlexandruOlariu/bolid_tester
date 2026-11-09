/** Settings → Security access plugins → **Test in simulator** (plan 23). Runs an imported plugin
 *  through the real unlock path against a simulated module, never the car:
 *
 *  1. compile the program and run it twice on a fixed test seed (`12 34` or `12 34 56 78`) — it
 *     must stay within the limits, give a key of the declared width and give the same key twice;
 *  2. build a one-module simulator scenario whose SecurityAccess model expects **that** key for
 *     that seed and protects `2E` — the simulator itself never derives a key;
 *  3. check the simulated module refuses a write while locked (`7F 2E 33`), then run the same
 *     `codeModule` flow the Coding screen uses — read backup → `10 03` → `27` seed/key → `2E` of
 *     the same bytes → re-read and verify.
 *
 *  A pass proves the file is usable by the app end to end. It cannot prove the routine is right
 *  for the owner's module — only the car can — and the result says so. */
import {
  DiagnosticSession,
  MockTransport,
  UdsError,
  codeModule,
  compileSeedKey,
  hexBytes,
  type ProtocolId,
  type SeedKeyPluginV1,
} from '@/shared/obd-core';

export interface SimulatorCheckResult {
  ok: boolean;
  message: string;
  seed: number[];
  key: number[] | null;
  steps: number | null;
}

const TEST_DID = 'F1A0';
const TEST_CODING = [0x01, 0x00, 0x10, 0x00];

const spaced = (bytes: number[]) =>
  hexBytes(bytes)
    .toUpperCase()
    .replace(/(..)(?!$)/g, '$1 ');

/** The header the simulated module answers on: the plugin's own, else a stand-in. */
function simHeader(plugin: SeedKeyPluginV1): { header: string; protocol: ProtocolId } {
  const h = plugin.applies.reqHeader;
  if (h && h.length === 8) return { header: h, protocol: 'ISO_15765_4_CAN_29_500' };
  return { header: h ?? '7E0', protocol: 'ISO_15765_4_CAN_11_500' };
}

export async function testSeedKeyPluginInSimulator(
  plugin: SeedKeyPluginV1,
): Promise<SimulatorCheckResult> {
  const seed = plugin.seedBytes === 2 ? [0x12, 0x34] : [0x12, 0x34, 0x56, 0x78];
  const fail = (message: string, key: number[] | null = null, steps: number | null = null) => ({
    ok: false,
    message: `Failed in the simulator: ${message}`,
    seed,
    key,
    steps,
  });

  let key: number[];
  let steps: number;
  try {
    const first = compileSeedKey(plugin);
    steps = first.steps;
    key = first(seed);
    const again = compileSeedKey(plugin)(seed);
    if (again.length !== key.length || again.some((b, i) => b !== key[i])) {
      return fail('the routine gave a different key for the same seed.', key, steps);
    }
    if (key.length !== plugin.keyBytes) {
      return fail(`the key has ${key.length} bytes, not ${plugin.keyBytes}.`, key, steps);
    }
  } catch (e) {
    return fail((e as Error).message);
  }

  const { header, protocol } = simHeader(plugin);
  const session = new DiagnosticSession(
    new MockTransport({
      protocol,
      supportedPids: ['010C'],
      coding: { [header]: { [TEST_DID]: TEST_CODING.slice() } },
      security: {
        [header]: { level: plugin.applies.level, seed, key: key.slice(), protects: ['2E'] },
      },
    }),
  );
  try {
    await session.connect();
    await session.setHeader(header);
    const send = (cmd: string) => session.send(cmd);
    try {
      await codeModule(send, { did: TEST_DID, newData: TEST_CODING });
      return fail('the simulated module accepted a write without unlocking.', key, steps);
    } catch (e) {
      if (!(e instanceof UdsError) || e.nrc !== 0x33) throw e;
    }
    const res = await codeModule(send, {
      did: TEST_DID,
      newData: TEST_CODING,
      security: { level: plugin.applies.level, seedToKey: compileSeedKey(plugin) },
    });
    if (!res.verified) return fail('the write after the unlock did not verify.', key, steps);
    return {
      ok: true,
      message:
        `Passed in the simulator: the routine ran in ${steps} steps, turned test seed ` +
        `${spaced(seed)} into key ${spaced(key)}, and a simulated module unlocked with it and ` +
        'accepted a write. The simulator cannot tell whether the routine is right for your car — ' +
        'only the car can.',
      seed,
      key,
      steps,
    };
  } catch (e) {
    return fail((e as Error).message, key, steps);
  } finally {
    await session.disconnect().catch(() => undefined);
  }
}
