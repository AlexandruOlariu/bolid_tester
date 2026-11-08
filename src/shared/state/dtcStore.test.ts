/** `lastReadAt` only counts real reads (plan 01 review): opening Faults with no session must not tick
 *  the first-run card's "Read fault codes" step. */
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
