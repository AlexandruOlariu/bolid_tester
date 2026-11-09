/** Plan 23 acceptance on the simulated Golf with a test `security` model on the BCM (70E): a
 *  coding write to a module that needs SecurityAccess is refused with the "no plugin" message and
 *  nothing reaches the adapter (no `27`, checked in the adapter log); after importing the fixture
 *  plugin the same write unlocks and verifies. The plugin and the scenario's seed / key are a
 *  deliberately trivial TEST VECTOR (seed XOR 0xFFFF), not a routine for any real module. */
import { act, renderHook } from '@testing-library/react-native';
import * as scenarios from '@/shared/obd-core/transport/scenarios';
import { getVehicleProfile, type CodingModule } from '@/shared/vehicles';
import { adapterLogSnapshot, clearAdapterLog } from '@/shared/state/adapterLog';
import { parseSeedKeyFile } from '@/shared/lib/exchange/seedKey';
import { NO_PLUGIN_MESSAGE } from '@/shared/security';
import * as seedKeyFiles from '@/shared/security/seedKeyFiles';
import { connectSimulator } from '@test/simulator';
import { fileSystemMock } from '@test/mocks/fileSystem';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';
import { useCodingStore } from '../model/codingStore';
import { useCoding } from './useCoding';

const FIXTURE_PLUGIN = JSON.stringify({
  schema: 'bolid.seedkey.v1',
  name: 'Test vector BCM',
  applies: { reqHeader: '70E', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  program: [{ op: 'load', from: 'seed' }, { op: 'xor', value: 0xffff }, { op: 'store' }],
});

const bcm = getVehicleProfile('golf-plus-2009-20tdi').codingModules!.find(
  (m) => m.reqHeader === '70E',
)!;
const securedBcm: CodingModule = { ...bcm, security: { level: 0x03 } };

const sentCommands = () =>
  adapterLogSnapshot()
    .filter((e) => e.dir === 'tx')
    .map((e) => e.text.trim().toUpperCase());

describe('useCoding.write with SecurityAccess (plan 23)', () => {
  beforeEach(() => {
    // The variable-specifier native import is faked at the loader, as in the other UI tests; the
    // files land in the in-memory file system.
    jest.spyOn(seedKeyFiles, 'loadSeedKeyModules').mockResolvedValue({
      FileSystem: fileSystemMock,
      Picker: null,
    });
    // The module's own refusal in the second case is logged (dev builds echo it to the console).
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const real = scenarios.buildScenario;
    jest.spyOn(scenarios, 'buildScenario').mockImplementation((id, overrides = {}) =>
      real(id, {
        ...overrides,
        security: {
          '70E': { level: 0x03, seed: [0x12, 0x34], key: [0xed, 0xcb], protects: ['2E'] },
        },
      }),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('refuses without a plugin (no 27 on the wire), then verifies once the plugin is imported', async () => {
    await connectSimulator();
    useCodingStore.setState({ unlocked: true });
    const { result } = renderHook(() => useCoding());
    const next = [0x01, 0x01, 0x10, 0x00];

    clearAdapterLog();
    let ok = true;
    await act(async () => {
      ok = await result.current.write(securedBcm, next);
    });
    expect(ok).toBe(false);
    expect(useCodingStore.getState().lastResult).toBe(NO_PLUGIN_MESSAGE);
    expect(sentCommands()).toEqual([]);

    const parsed = parseSeedKeyFile(FIXTURE_PLUGIN);
    if (!parsed.ok) throw new Error(parsed.error);
    const mods = await seedKeyFiles.loadSeedKeyModules();
    expect((await seedKeyFiles.installSeedKeyPlugin(mods!, parsed.plugin)).ok).toBe(true);

    clearAdapterLog();
    await act(async () => {
      ok = await result.current.write(securedBcm, next);
    });
    expect(useCodingStore.getState().lastResult).toBe('Write verified.');
    expect(ok).toBe(true);
    expect(sentCommands()).toEqual(expect.arrayContaining(['2703', '2704EDCB']));
  });

  it('a part-number-scoped plugin matches only the scanned part number, never the profile one', async () => {
    await connectSimulator();
    useCodingStore.setState({ unlocked: true });
    // The profile's BCM declares an illustrative part number this prefix matches.
    expect(securedBcm.partNumber).toMatch(/^1K0937087/);
    const parsed = parseSeedKeyFile(
      JSON.stringify({
        ...JSON.parse(FIXTURE_PLUGIN),
        name: 'Test vector BCM by part',
        applies: { partNumberPrefix: '1K0937087', level: 3 },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const mods = await seedKeyFiles.loadSeedKeyModules();
    expect((await seedKeyFiles.installSeedKeyPlugin(mods!, parsed.plugin)).ok).toBe(true);
    const { result } = renderHook(() => useCoding());
    const next = [0x01, 0x01, 0x10, 0x00];

    // No module scan yet: the real part number is unknown, so the write fails closed.
    clearAdapterLog();
    let ok = true;
    await act(async () => {
      ok = await result.current.write(securedBcm, next);
    });
    expect(ok).toBe(false);
    expect(useCodingStore.getState().lastResult).toBe(NO_PLUGIN_MESSAGE);
    expect(sentCommands()).toEqual([]);

    const scanned = (partNumber: string) =>
      act(() => {
        useModuleScanStore.setState({
          results: [
            {
              module: {
                address: '09',
                name: 'Central electrics',
                transport: 'uds',
                reqHeader: '70E',
                experimental: true,
              },
              state: 'ok',
              ident: { partNumber, raw: {} },
              dtcs: [],
            },
          ],
        });
      });

    // The scan read a different part number: still refused.
    scanned('5K0937087A');
    expect(result.current.partNumberFor(securedBcm)).toBe('5K0937087A');
    clearAdapterLog();
    await act(async () => {
      ok = await result.current.write(securedBcm, next);
    });
    expect(ok).toBe(false);
    expect(sentCommands()).toEqual([]);

    // The scan read a matching part number: the plugin unlocks the write.
    scanned('1K0937087D');
    clearAdapterLog();
    await act(async () => {
      ok = await result.current.write(securedBcm, next);
    });
    expect(useCodingStore.getState().lastResult).toBe('Write verified.');
    expect(ok).toBe(true);
    expect(sentCommands()).toEqual(expect.arrayContaining(['2703', '2704EDCB']));
  });

  it('a module without security still writes without any 27', async () => {
    await connectSimulator();
    useCodingStore.setState({ unlocked: true });
    const { result } = renderHook(() => useCoding());
    clearAdapterLog();
    // The test scenario protects 2E on the BCM, so the module itself refuses the unlocked write.
    await act(async () => {
      await result.current.write(bcm, [0x01, 0x01, 0x10, 0x00]);
    });
    expect(useCodingStore.getState().lastResult).toMatch(/securityAccessDenied/);
    expect(sentCommands().some((c) => c.startsWith('27'))).toBe(false);
  });
});
