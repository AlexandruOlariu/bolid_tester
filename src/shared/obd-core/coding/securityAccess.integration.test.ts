/** End-to-end SecurityAccess (plan 23): the Golf BCM behind a simulated `27` model, unlocked by a
 *  plugin program compiled with the DSL, through the same `codeModule` path the Coding screen
 *  uses. The plugin and the scenario's seed / key are a deliberately trivial TEST VECTOR (seed
 *  XOR 0xFFFF) that exists only in tests — not a routine for any real module. */
import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { codeModule, UdsError } from './udsCoding';
import { compileSeedKey, type SeedKeyPluginV1 } from './seedKeyDsl';
import { getVehicleProfile } from '../../vehicles';

const TOY_PLUGIN: SeedKeyPluginV1 = {
  schema: 'bolid.seedkey.v1',
  name: 'Test vector — not a real routine',
  applies: { reqHeader: '70E', level: 0x03 },
  seedBytes: 2,
  keyBytes: 2,
  program: [{ op: 'load', from: 'seed' }, { op: 'xor', value: 0xffff }, { op: 'store' }],
};

describe('SecurityAccess against the simulated Golf BCM', () => {
  const bcm = getVehicleProfile('golf-plus-2009-20tdi').codingModules!.find(
    (m) => m.reqHeader === '70E',
  )!;

  async function securedGolf() {
    const sent: string[] = [];
    const session = new DiagnosticSession(
      new MockTransport(
        buildScenario('golf-plus-2009-20tdi', {
          security: {
            '70E': { level: 0x03, seed: [0x12, 0x34], key: [0xed, 0xcb], protects: ['2E'] },
          },
        }),
      ),
    );
    await session.connect();
    await session.setHeader(bcm.reqHeader);
    await session.setRxFilter(bcm.rxFilter);
    const send = (cmd: string) => {
      sent.push(cmd);
      return session.send(cmd);
    };
    return { session, send, sent };
  }

  it('unlocks with the compiled plugin, writes and verifies', async () => {
    const { send, sent } = await securedGolf();
    const res = await codeModule(send, {
      did: bcm.codingDid,
      newData: [0x01, 0x01, 0x10, 0x00],
      security: { level: 0x03, seedToKey: compileSeedKey(TOY_PLUGIN) },
    });
    expect(res.verified).toBe(true);
    expect(res.backup).toEqual([0x01, 0x00, 0x10, 0x00]);
    expect(sent).toEqual(expect.arrayContaining(['2703', '2704edcb']));
  });

  it('without the security option the module refuses the write with NRC 0x33', async () => {
    const { send } = await securedGolf();
    const err = await codeModule(send, {
      did: bcm.codingDid,
      newData: [0x01, 0x01, 0x10, 0x00],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UdsError);
    expect((err as UdsError).nrc).toBe(0x33);
  });

  it('a wrong routine is rejected with NRC 0x35 and nothing is written', async () => {
    const { session, send } = await securedGolf();
    const wrong = compileSeedKey({
      ...TOY_PLUGIN,
      program: [{ op: 'load', from: 'seed' }, { op: 'store' }],
    });
    const err = await codeModule(send, {
      did: bcm.codingDid,
      newData: [0x01, 0x01, 0x10, 0x00],
      security: { level: 0x03, seedToKey: wrong },
    }).catch((e: unknown) => e);
    expect((err as UdsError).nrc).toBe(0x35);
    expect(await session.readExtended(bcm.codingDid)).toEqual([0x01, 0x00, 0x10, 0x00]);
  });
});
