/** `lastReadAt` only counts real reads (plan 01 review): opening Faults with no session must not tick
 *  the first-run card's "Read fault codes" step. */
/** `set` stamps results with the active car (`activeCarStamp`), whose garage / vehicle stores
 *  persist through expo-file-system (ESM, not transformed in the node env): mock it to a no-op. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { useDtcStore } from './dtcStore';

const RESULT = { stored: [], pending: [], permanent: [], readiness: null, freezeFrames: [] };

beforeEach(() => useDtcStore.setState(useDtcStore.getInitialState(), true));

describe('dtcStore.lastReadAt', () => {
  it('starts null', () => {
    expect(useDtcStore.getState().lastReadAt).toBeNull();
  });

  it('is stamped by a published read', () => {
    useDtcStore.getState().set(RESULT);
    expect(useDtcStore.getState().lastReadAt).toEqual(expect.any(Number));
  });

  it('clearResults empties the lists without counting as a read', () => {
    useDtcStore.setState({ stored: [{ code: 'P0135' } as never] });
    useDtcStore.getState().clearResults();
    expect(useDtcStore.getState().stored).toEqual([]);
    expect(useDtcStore.getState().lastReadAt).toBeNull();
  });
});

describe('dtcStore.readFor', () => {
  it('stamps a published read with the active car and drops it on clearResults', () => {
    useDtcStore.getState().set(RESULT);
    expect(useDtcStore.getState().readFor).toMatchObject({ id: 'generic', vin: null });
    useDtcStore.getState().clearResults();
    expect(useDtcStore.getState().readFor).toBeNull();
    expect(useDtcStore.getState().lastReadAt).toEqual(expect.any(Number));
  });
});
