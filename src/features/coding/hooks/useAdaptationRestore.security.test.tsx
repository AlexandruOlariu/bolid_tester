/** Plan 23 on the backup restore panel: a security channel is restorable only when an installed
 *  plugin unlocks its module, resolved exactly as on the Adaptations screen — header, address and
 *  the part number the live module scan read. A plugin scoped by part-number prefix therefore stays
 *  skipped as `locked` until a scan reports a matching part number. */
import { act, renderHook } from '@testing-library/react-native';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useSeedKeyStore, type SeedKeyIndexEntry } from '@/shared/state/seedKeyStore';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';
import { buildCarBackup } from '../api/carBackup';
import { useAdaptationRestore } from './useAdaptationRestore';

const PREFIX_PLUGIN: SeedKeyIndexEntry = {
  id: 'test-ecu-by-part',
  name: 'Test vector ECU by part',
  applies: { partNumberPrefix: '03L906022', level: 3 },
  seedBytes: 2,
  keyBytes: 2,
  fileUri: 'file:///seedkeys/test-ecu-by-part.json',
  importedAt: 1,
};

describe('useAdaptationRestore.plan with SecurityAccess (plan 23)', () => {
  const ch = getVehicleProfile('golf-plus-2009-20tdi').adaptations!.find((c) => c.did === '3001')!;
  let had: boolean;
  let saved: typeof ch.security;

  beforeEach(() => {
    // The registry channel is shared module state: give it a test `security` and restore it after.
    had = Object.prototype.hasOwnProperty.call(ch, 'security');
    saved = ch.security;
    ch.security = { level: 3 };
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    useSeedKeyStore.setState({ plugins: [PREFIX_PLUGIN] });
  });
  afterEach(() => {
    if (had) ch.security = saved;
    else delete ch.security;
  });

  const module = buildCarBackup({
    vehicle: { id: 'golf-plus-2009-20tdi', label: 'Golf', vin: null },
    protocol: 'CAN',
    modules: [
      {
        reqHeader: ch.reqHeader,
        name: 'Engine (EDC17)',
        adaptations: [{ did: ch.did, name: ch.name, unit: ch.unit, raw: [0x03, 0x84], value: 900 }],
      },
    ],
  }).modules[0];
  const current = { [ch.did]: [0x03, 0x52] };

  const scanned = (partNumber: string) =>
    act(() => {
      useModuleScanStore.setState({
        results: [
          {
            module: {
              address: '01',
              name: 'Engine',
              transport: 'uds',
              reqHeader: ch.reqHeader,
              experimental: true,
            },
            state: 'ok',
            ident: { partNumber, raw: {} },
            dtcs: [],
          },
        ],
      });
    });

  const actionFor = (plan: ReturnType<ReturnType<typeof useAdaptationRestore>['plan']>) => {
    const item = plan.find((i) => i.did === ch.did);
    return item?.action === 'skip' ? item.skip : item?.action;
  };

  it('stays locked while the module part number is unknown or different', () => {
    const { result } = renderHook(() => useAdaptationRestore());
    expect(actionFor(result.current.plan(module, current))).toBe('locked');
    scanned('04L906021A');
    expect(actionFor(result.current.plan(module, current))).toBe('locked');
  });

  it('is restorable once the scan reports a part number the plugin names', () => {
    scanned('03L906022LM');
    const { result } = renderHook(() => useAdaptationRestore());
    expect(actionFor(result.current.plan(module, current))).toBe('restore');
  });
});
