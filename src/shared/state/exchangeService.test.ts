/** Profile and label-pack import / export service (plan 13) against in-memory fakes of the file
 *  system, share sheet and document picker, and the real garage and label-pack stores. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import * as fs from 'fs';
import * as path from 'path';
import { findLabelPack, adaptationLabel } from '@/shared/labels';
import { useGarageStore } from './garageStore';
import { useLabelPackStore } from './labelPackStore';
import { useErrorLogStore } from './errorLogStore';
import {
  applyImport,
  isParseError,
  pickExchangeFile,
  previewImport,
  shareExchangeFile,
  vehicleExportFile,
  labelPackExportFile,
  type ExchangeModules,
  type ImportPreview,
} from './exchangeService';
import { parseExchangeFile, serializeExchange, type ParsedExchange } from '@/shared/lib/exchange';
import { vagEdc17Golf } from '@/shared/labels/packs/vagEdc17Golf';
import type { UserVehicle } from '@/shared/vehicles';

const EXAMPLES = path.resolve(__dirname, '../../../docs/examples');
const example = (name: string) => fs.readFileSync(path.join(EXAMPLES, name), 'utf8');

function fakeModules(pickedText: string | null, opts: { size?: number } = {}) {
  const written = new Map<string, string>();
  const mods: ExchangeModules = {
    FileSystem: {
      documentDirectory: '/docs/',
      getInfoAsync: jest.fn(async (uri: string) => ({
        exists: uri === '/cache/picked.json' || written.has(uri),
        size: opts.size ?? (pickedText ?? '').length,
      })),
      readAsStringAsync: jest.fn(async () => pickedText ?? ''),
      writeAsStringAsync: jest.fn(async (uri: string, text: string) => {
        written.set(uri, text);
      }),
    },
    Sharing: {
      isAvailableAsync: jest.fn(async () => true),
      shareAsync: jest.fn(async () => undefined),
    },
    Picker: {
      getDocumentAsync: jest.fn(async () =>
        pickedText === null
          ? { canceled: true, assets: null }
          : { canceled: false, assets: [{ uri: '/cache/picked.json', name: 'picked.json' }] },
      ),
    },
  };
  return { mods, written };
}

function parsed(text: string): ParsedExchange {
  const r = parseExchangeFile(text);
  if (isParseError(r)) throw new Error(r.error);
  return r;
}

const CAR: UserVehicle = {
  id: 'user:golf',
  name: 'Volkswagen 2009',
  year: 2009,
  fuel: 'diesel',
  make: 'vag',
  baseProfileId: 'golf-plus-2009-20tdi',
  learned: {
    protocol: 'ISO_15765_4_CAN_11_500',
    supportedPids: ['010C', '010D'],
    vin: 'WVWZZZ1KZ9W903398',
    calibrationId: null,
    learnedAt: 5,
  },
  loginCodes: [{ address: '01', code: 12345, purpose: 'Idle', source: 'user-entered' }],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  useGarageStore.setState({ vehicles: [] });
  useLabelPackStore.setState({ packs: [] });
  useErrorLogStore.setState({ errors: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('pickExchangeFile', () => {
  it('parses the picked file', async () => {
    const { mods } = fakeModules(example('label-pack.example.json'));
    const r = await pickExchangeFile(mods, 'test');
    expect(r.status).toBe('picked');
    if (r.status === 'picked') {
      expect(r.name).toBe('picked.json');
      expect(isParseError(r.result)).toBe(false);
    }
  });

  it('cancelled, unavailable, and an oversize file refused before it is read', async () => {
    expect((await pickExchangeFile(fakeModules(null).mods, 'test')).status).toBe('cancelled');
    const { mods } = fakeModules('{}');
    expect((await pickExchangeFile({ ...mods, Picker: null }, 'test')).status).toBe('unavailable');
    const big = fakeModules('{}', { size: 2_000_000 });
    const r = await pickExchangeFile(big.mods, 'test');
    expect(r.status === 'picked' && isParseError(r.result) && r.result.error).toMatch(/too large/);
    expect(big.mods.FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('a read failure is logged and shown, not thrown', async () => {
    const { mods } = fakeModules('{}');
    (mods.FileSystem.readAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('gone'));
    const r = await pickExchangeFile(mods, 'test/source');
    expect(r.status === 'picked' && isParseError(r.result) && r.result.error).toBe(
      'The file could not be opened.',
    );
    expect(useErrorLogStore.getState().errors[0]).toMatchObject({ source: 'test/source' });
  });
});

describe('profile import', () => {
  it('export a garage car → import on a cleared app → the same car; again → Replace / Keep both', () => {
    const text = serializeExchange(vehicleExportFile(CAR));
    expect(text).not.toContain('12345'); // the code book stays on the phone

    const first = previewImport(parsed(text));
    expect(first.kind === 'profile' && first.plan).toEqual({ action: 'create' });
    const out = applyImport(first, 'create');
    expect(out).toMatchObject({ ok: true, message: 'Imported Volkswagen 2009.' });
    const [car] = useGarageStore.getState().vehicles;
    const { id: _a, createdAt: _b, updatedAt: _c, loginCodes: _d, ...same } = CAR;
    const { id: _e, createdAt: _f, updatedAt: _g, ...imported } = car;
    expect(imported).toEqual(same);

    const again = previewImport(parsed(text)) as Extract<ImportPreview, { kind: 'profile' }>;
    expect(again.plan).toMatchObject({
      action: 'conflict',
      existingId: car.id,
      reason: 'same-vin',
    });
    expect(applyImport(again, 'create').ok).toBe(false);
    expect(useGarageStore.getState().vehicles).toHaveLength(1);

    applyImport(again, 'keep-both');
    expect(useGarageStore.getState().vehicles.map((v) => v.name)).toEqual([
      'Volkswagen 2009',
      'Volkswagen 2009 (2)',
    ]);
  });

  it('Replace overwrites the fields but keeps the id, createdAt and the local code book', () => {
    const local = useGarageStore.getState().add({
      name: 'Volkswagen 2009',
      fuel: 'petrol',
      baseProfileId: 'generic',
      notes: 'old notes',
      loginCodes: [{ address: '46', code: 1, purpose: 'Comfort', source: 'user-entered' }],
    });
    const preview = previewImport(parsed(serializeExchange(vehicleExportFile(CAR))));
    expect(preview.kind === 'profile' && preview.plan).toMatchObject({ reason: 'same-name' });
    applyImport(preview, 'replace');
    const [car] = useGarageStore.getState().vehicles;
    expect(car.id).toBe(local.id);
    expect(car.createdAt).toBe(local.createdAt);
    expect(car.fuel).toBe('diesel');
    expect(car.notes).toBeUndefined();
    expect(car.learned?.vin).toBe('WVWZZZ1KZ9W903398');
    expect(car.loginCodes).toEqual(local.loginCodes);
  });

  it('the example seed lands on its base profile; embedded packs are added once', () => {
    const preview = previewImport(parsed(example('profile.example.json')));
    expect(preview.kind === 'profile' && preview.baseKnown).toBe(true);
    applyImport(preview, 'create');
    expect(useGarageStore.getState().vehicles[0]).toMatchObject({
      baseProfileId: 'golf-plus-2009-20tdi',
      fuel: 'diesel',
    });
    expect(useGarageStore.getState().vehicles[0].learned).toBeUndefined();

    // A car file with an embedded pack (the exporting phone had imported it).
    const packFile = parsed(example('label-pack.example.json'));
    if (packFile.kind !== 'labelpack') throw new Error('expected a label pack');
    useLabelPackStore.getState().add(packFile.file.payload);
    const withPack = serializeExchange(vehicleExportFile(CAR));
    useLabelPackStore.setState({ packs: [] });
    const p = previewImport(parsed(withPack));
    expect(p.kind === 'profile' && p.packs.add.map((x) => x.id)).toEqual([
      'example-edc17-03L906022',
    ]);
    expect(applyImport(p, 'create')).toMatchObject({
      ok: true,
      message: 'Imported Volkswagen 2009 and 1 label pack.',
    });
    expect(useLabelPackStore.getState().packs).toHaveLength(1);
  });

  it('embedded packs keep their precedence order on the receiving phone', () => {
    const packFile = parsed(example('label-pack.example.json'));
    if (packFile.kind !== 'labelpack') throw new Error('expected a label pack');
    const a = { ...packFile.file.payload, id: 'pack-a' };
    const b = { ...packFile.file.payload, id: 'pack-b' };
    useLabelPackStore.setState({ packs: [a, b] }); // same prefix: the first (newest) wins
    expect(findLabelPack('03L906022LM')?.id).toBe('pack-a');
    const text = serializeExchange(vehicleExportFile(CAR));
    useLabelPackStore.setState({ packs: [] });
    expect(applyImport(previewImport(parsed(text)), 'create')).toMatchObject({
      ok: true,
      message: 'Imported Volkswagen 2009 and 2 label packs.',
    });
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual(['pack-a', 'pack-b']);
    expect(findLabelPack('03L906022LM')?.id).toBe('pack-a');
  });
});

describe('label-pack import', () => {
  it('import the example pack → lookups see it; delete → the bundled names return', () => {
    const preview = previewImport(parsed(example('label-pack.example.json')));
    expect(preview.kind === 'labelpack' && preview.plan.overlaps[0].packId).toBe(vagEdc17Golf.id);
    expect(applyImport(preview, 'create')).toMatchObject({ ok: true });
    const pack = findLabelPack('03L906022LM');
    expect(adaptationLabel(pack, '3001')?.description).toMatch(/^Example pack/);
    useLabelPackStore.getState().remove('example-edc17-03L906022');
    expect(adaptationLabel(findLabelPack('03L906022LM'), '3001')?.description).toMatch(
      /Base idle target/,
    );
  });

  it('same id again → Replace or Keep both (id gets -2)', () => {
    const text = example('label-pack.example.json');
    applyImport(previewImport(parsed(text)), 'create');
    const again = previewImport(parsed(text));
    expect(again.kind === 'labelpack' && again.plan.action).toBe('replace');
    expect(applyImport(again, 'create').ok).toBe(false);
    applyImport(again, 'keep-both');
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual([
      'example-edc17-03L906022-2',
      'example-edc17-03L906022',
    ]);
    applyImport(again, 'replace');
    expect(useLabelPackStore.getState().packs).toHaveLength(2);
  });

  it('a corrupted file changes nothing', () => {
    const raw = JSON.parse(example('label-pack.example.json')) as { payload: { id: string } };
    raw.payload.id = '';
    const r = parseExchangeFile(JSON.stringify(raw));
    expect(isParseError(r)).toBe(true);
    expect(useLabelPackStore.getState().packs).toEqual([]);
    expect(useGarageStore.getState().vehicles).toEqual([]);
  });

  it('a bundled pack exports as a template file that imports back', () => {
    const text = serializeExchange(labelPackExportFile(vagEdc17Golf));
    const preview = previewImport(parsed(text));
    expect(preview.kind).toBe('labelpack');
    expect(applyImport(preview, 'create').ok).toBe(true);
    expect(findLabelPack('03L906022LM')).not.toBe(vagEdc17Golf); // the imported copy wins the tie
  });
});

describe('shareExchangeFile', () => {
  it('writes bolid-profile-<slug>-<stamp>.json and opens the share sheet', async () => {
    const { mods, written } = fakeModules(null);
    const now = new Date(Date.UTC(2026, 10, 9, 10));
    const uri = await shareExchangeFile(mods, vehicleExportFile(CAR, now.getTime()), {
      source: 'test',
      title: 'Share',
      now,
    });
    expect(uri).toBe('/docs/bolid-profile-volkswagen-2009-2026-11-09T10-00-00-000Z.json');
    expect(isParseError(parseExchangeFile(written.get(uri as string) as string))).toBe(false);
    expect(mods.Sharing?.shareAsync).toHaveBeenCalledWith(uri, {
      mimeType: 'application/json',
      dialogTitle: 'Share',
    });
  });

  it('refuses to write a file that does not match its schema', async () => {
    const { mods, written } = fakeModules(null);
    const file = vehicleExportFile(CAR);
    const bad = { ...file, payload: { ...file.payload, vehicle: { ...file.payload.vehicle } } };
    bad.payload.vehicle.name = '';
    const uri = await shareExchangeFile(mods, bad, { source: 'test/export', title: 'Share' });
    expect(uri).toBeNull();
    expect(written.size).toBe(0);
    expect(mods.Sharing?.shareAsync).not.toHaveBeenCalled();
    expect(useErrorLogStore.getState().errors[0]).toMatchObject({
      source: 'test/export',
      severity: 'warning',
    });
  });

  it('a garage car with an over-long name (saved before the editor capped it) still exports', async () => {
    const { mods, written } = fakeModules(null);
    const uri = await shareExchangeFile(
      mods,
      vehicleExportFile({ ...CAR, name: 'x'.repeat(120) }),
      {
        source: 'test',
        title: 'Share',
      },
    );
    expect(uri).not.toBeNull();
    expect(isParseError(parseExchangeFile(written.get(uri as string) as string))).toBe(false);
  });

  it('logs and returns null without a document directory', async () => {
    const { mods } = fakeModules(null);
    const uri = await shareExchangeFile(
      { ...mods, FileSystem: { ...mods.FileSystem, documentDirectory: null } },
      labelPackExportFile(vagEdc17Golf),
      { source: 'settings/label-packs', title: 'Share' },
    );
    expect(uri).toBeNull();
    expect(useErrorLogStore.getState().errors[0]).toMatchObject({
      source: 'settings/label-packs',
      severity: 'warning',
    });
  });
});
