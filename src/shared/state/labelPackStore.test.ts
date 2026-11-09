/** Imported label packs (plan 13): add / replace / remove, the 100-pack cap, the registry push
 *  and re-validation of a persisted blob. Node-safe: the persist file system is an in-memory map. */
const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    files.delete(uri);
  }),
}));

import { findLabelPack, adaptationLabel } from '@/shared/labels';
import type { LabelPackV1 } from '@/shared/lib/exchange';
import { MAX_USER_LABEL_PACKS } from '@/shared/lib/exchange';
import { sanitizeLabelPacks, useLabelPackStore } from './labelPackStore';

const FILE = '/tmp/bolid-test/bolid.labelPacks.json';

const pack = (id: string, extra: Partial<LabelPackV1> = {}): LabelPackV1 => ({
  id,
  module: `Module ${id}`,
  partNumberPrefixes: ['03L906022'],
  adaptations: { '3001': { name: 'Idle speed offset', description: `From ${id}` } },
  ...extra,
});

beforeEach(() => {
  files.clear();
  useLabelPackStore.setState({ packs: [] });
});

describe('labelPackStore', () => {
  it('add puts the newest pack first and refuses a duplicate id', () => {
    const s = useLabelPackStore.getState();
    expect(s.add(pack('a'))).toBe(true);
    expect(useLabelPackStore.getState().add(pack('b'))).toBe(true);
    expect(useLabelPackStore.getState().add(pack('a'))).toBe(false);
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('replace swaps the pack and moves it to the front; remove deletes it', () => {
    const s = useLabelPackStore.getState();
    s.add(pack('a'));
    useLabelPackStore.getState().add(pack('b'));
    expect(useLabelPackStore.getState().replace('a', pack('a', { module: 'New A' }))).toBe(true);
    expect(useLabelPackStore.getState().packs.map((p) => [p.id, p.module])).toEqual([
      ['a', 'New A'],
      ['b', 'Module b'],
    ]);
    expect(useLabelPackStore.getState().replace('zzz', pack('zzz'))).toBe(false);
    useLabelPackStore.getState().remove('a');
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual(['b']);
  });

  it(`caps the store at ${MAX_USER_LABEL_PACKS} packs`, () => {
    useLabelPackStore.setState({
      packs: Array.from({ length: MAX_USER_LABEL_PACKS }, (_, i) => pack(`p${i}`)),
    });
    expect(useLabelPackStore.getState().add(pack('one-too-many'))).toBe(false);
    expect(useLabelPackStore.getState().packs).toHaveLength(MAX_USER_LABEL_PACKS);
    // A replace still fits.
    expect(useLabelPackStore.getState().replace('p5', pack('p5', { module: 'x' }))).toBe(true);
  });

  it('pushes every change into the label registry', () => {
    expect(findLabelPack('03L906022LM')?.id).toBe('vag-edc17-03L906022');
    useLabelPackStore.getState().add(pack('mine'));
    const found = findLabelPack('03L906022LM');
    expect(found?.id).toBe('mine');
    expect(adaptationLabel(found, '3001')?.description).toBe('From mine');
    useLabelPackStore.getState().remove('mine');
    expect(findLabelPack('03L906022LM')?.id).toBe('vag-edc17-03L906022');
  });

  it('persists as bolid.labelPacks v1', async () => {
    useLabelPackStore.getState().add(pack('a'));
    await new Promise((r) => setTimeout(r, 0));
    const stored = JSON.parse(files.get(FILE) ?? 'null') as {
      version: number;
      state: { packs: LabelPackV1[] };
    };
    expect(stored.version).toBe(1);
    expect(stored.state.packs.map((p) => p.id)).toEqual(['a']);
  });

  it('rehydrate re-validates the stored packs and pushes them to the registry', async () => {
    files.set(
      FILE,
      JSON.stringify({
        version: 1,
        state: {
          packs: [
            pack('good'),
            { id: 'bad', module: 'Bad', partNumberPrefixes: ['lowercase'] },
            pack('good'),
            'junk',
          ],
        },
      }),
    );
    await useLabelPackStore.persist.rehydrate();
    expect(useLabelPackStore.getState().packs.map((p) => p.id)).toEqual(['good']);
    expect(findLabelPack('03L906022LM')?.id).toBe('good');
  });

  it('sanitizeLabelPacks drops malformed entries and duplicates', () => {
    expect(sanitizeLabelPacks(null)).toEqual([]);
    expect(sanitizeLabelPacks({ packs: 'x' })).toEqual([]);
    const withExtra = { ...pack('a'), decode: 'function () {}' };
    expect(sanitizeLabelPacks({ packs: [withExtra, pack('a')] })).toEqual([pack('a')]);
  });
});
