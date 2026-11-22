import { firstRunComplete, firstRunSteps, type FirstRunInput } from './firstRun';

const fresh: FirstRunInput = {
  selectedProfileId: 'generic',
  genericAccepted: false,
  connectionStatus: 'disconnected',
  dtcLastReadAt: null,
};

const doneIds = (i: FirstRunInput) =>
  firstRunSteps(i)
    .filter((s) => s.done)
    .map((s) => s.id);

describe('firstRunSteps', () => {
  it('returns the three steps in order with their routes', () => {
    expect(firstRunSteps(fresh).map((s) => [s.id, s.route])).toEqual([
      ['vehicle', '/vehicle'],
      ['connect', '/'],
      ['faults', '/faults'],
    ]);
  });

  it('marks nothing done on a fresh install', () => {
    expect(doneIds(fresh)).toEqual([]);
    expect(firstRunComplete(fresh)).toBe(false);
  });

  it('generic + connected + read → vehicle not done, the others done', () => {
    const i: FirstRunInput = { ...fresh, connectionStatus: 'connected', dtcLastReadAt: 1 };
    expect(doneIds(i)).toEqual(['connect', 'faults']);
    expect(firstRunComplete(i)).toBe(false);
  });

  it('counts a picked profile or an accepted Auto / Generic as the vehicle step', () => {
    expect(doneIds({ ...fresh, selectedProfileId: 'golf-plus-2009-20tdi' })).toEqual(['vehicle']);
    expect(doneIds({ ...fresh, genericAccepted: true })).toEqual(['vehicle']);
  });

  it('only a connected session counts — connecting / initializing / error do not', () => {
    for (const s of ['connecting', 'initializing', 'error', 'disconnected'] as const) {
      expect(doneIds({ ...fresh, connectionStatus: s })).toEqual([]);
    }
  });

  it('a read at epoch 0 still counts as read', () => {
    expect(doneIds({ ...fresh, dtcLastReadAt: 0 })).toEqual(['faults']);
  });
});

describe('firstRunComplete', () => {
  it('is true only when all three steps are done', () => {
    const all: FirstRunInput = {
      selectedProfileId: 'punto-2007-13mjtd',
      genericAccepted: false,
      connectionStatus: 'connected',
      dtcLastReadAt: Date.now(),
    };
    expect(firstRunComplete(all)).toBe(true);
    expect(firstRunComplete({ ...all, connectionStatus: 'disconnected' })).toBe(false);
    expect(firstRunComplete({ ...all, dtcLastReadAt: null })).toBe(false);
    expect(firstRunComplete({ ...all, selectedProfileId: 'generic' })).toBe(false);
    expect(firstRunComplete({ ...all, selectedProfileId: 'generic', genericAccepted: true })).toBe(
      true,
    );
  });
});
