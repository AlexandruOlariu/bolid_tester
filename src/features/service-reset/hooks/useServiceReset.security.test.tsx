/** Plan 23 step 5 on the simulated Golf, with a test `security` model on the cluster (714): a
 *  service reset whose descriptor needs SecurityAccess is refused with the "no plugin" message (plus
 *  the manual-procedure hint when the descriptor has one) and nothing reaches the adapter — no
 *  identity key, no `27`; after importing the fixture plugin the same reset unlocks and runs. The
 *  plugin and the scenario's seed / key are a deliberately trivial TEST VECTOR (seed XOR 0xFFFF),
 *  not a routine for any real module. */
import { act, renderHook } from '@testing-library/react-native';
import * as scenarios from '@/shared/obd-core/transport/scenarios';
import { getVehicleProfile, type ServiceReset } from '@/shared/vehicles';
import { adapterLogSnapshot, clearAdapterLog } from '@/shared/state/adapterLog';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { parseSeedKeyFile } from '@/shared/lib/exchange/seedKey';
import { NO_PLUGIN_MESSAGE } from '@/shared/security';
import * as seedKeyFiles from '@/shared/security/seedKeyFiles';
import { connectSimulator } from '@test/simulator';
import { fileSystemMock } from '@test/mocks/fileSystem';
import { useServiceResetStore } from '../model/serviceResetStore';
import { useServiceReset } from './useServiceReset';

const FIXTURE_PLUGIN = JSON.stringify({
  schema: 'bolid.seedkey.v1',
  name: 'Test vector cluster',
  applies: { reqHeader: '714', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  program: [{ op: 'load', from: 'seed' }, { op: 'xor', value: 0xffff }, { op: 'store' }],
});

const sentCommands = () =>
  adapterLogSnapshot()
    .filter((e) => e.dir === 'tx')
    .map((e) => e.text.trim().toUpperCase());

/** The registry descriptor is shared module state: patch it for one test, then restore it. */
function patchDescriptor(patch: Partial<ServiceReset>): () => void {
  const d = getVehicleProfile('golf-plus-2009-20tdi').serviceReset!;
  const saved = { ...d };
  Object.assign(d, patch);
  return () => {
    for (const k of Object.keys(patch) as (keyof ServiceReset)[]) delete d[k];
    Object.assign(d, saved);
  };
}

describe('useServiceReset with SecurityAccess (plan 23)', () => {
  let undo: () => void = () => undefined;

  beforeEach(() => {
    jest.spyOn(seedKeyFiles, 'loadSeedKeyModules').mockResolvedValue({
      FileSystem: fileSystemMock,
      Picker: null,
    });
    const real = scenarios.buildScenario;
    jest.spyOn(scenarios, 'buildScenario').mockImplementation((id, overrides = {}) =>
      real(id, {
        ...overrides,
        security: {
          '714': { level: 0x03, seed: [0x12, 0x34], key: [0xed, 0xcb], protects: ['31', '2E'] },
        },
      }),
    );
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  });
  afterEach(() => {
    undo();
    undo = () => undefined;
    jest.restoreAllMocks();
  });

  it('refuses without a plugin, appends the manual hint and sends nothing', async () => {
    undo = patchDescriptor({
      security: { level: 0x03 },
      manualProcedure: ['Hold the trip button while switching the ignition on.'],
    });
    await connectSimulator();
    const { result } = renderHook(() => useServiceReset());

    clearAdapterLog();
    let ok = true;
    await act(async () => {
      ok = await result.current.run();
    });
    expect(ok).toBe(false);
    expect(useServiceResetStore.getState().lastResult).toBe(
      `${NO_PLUGIN_MESSAGE} Use the manual procedure below instead.`,
    );
    expect(sentCommands()).toEqual([]);
  });

  it('refuses with the bare message when there is no manual procedure', async () => {
    undo = patchDescriptor({ security: { level: 0x03 } });
    await connectSimulator();
    const { result } = renderHook(() => useServiceReset());

    clearAdapterLog();
    await act(async () => {
      await result.current.run();
    });
    expect(useServiceResetStore.getState().lastResult).toBe(NO_PLUGIN_MESSAGE);
    expect(sentCommands()).toEqual([]);
  });

  it('unlocks with the installed plugin and runs the reset', async () => {
    undo = patchDescriptor({ security: { level: 0x03 } });
    await connectSimulator();
    const parsed = parseSeedKeyFile(FIXTURE_PLUGIN);
    if (!parsed.ok) throw new Error(parsed.error);
    const mods = await seedKeyFiles.loadSeedKeyModules();
    expect((await seedKeyFiles.installSeedKeyPlugin(mods!, parsed.plugin)).ok).toBe(true);
    const { result } = renderHook(() => useServiceReset());

    clearAdapterLog();
    let ok = false;
    await act(async () => {
      ok = await result.current.run();
    });
    expect(useServiceResetStore.getState().lastResult).toBe(
      'Service interval reset — confirm on the cluster.',
    );
    expect(ok).toBe(true);
    expect(sentCommands()).toEqual(expect.arrayContaining(['2703', '2704EDCB']));
  });
});
