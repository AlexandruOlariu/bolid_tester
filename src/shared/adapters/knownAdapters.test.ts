import committed from './knownAdapters.json';
import {
  communitySummary,
  KNOWN_ADAPTERS,
  knownAdapterChip,
  matchKnownAdapter,
  type KnownAdapter,
} from '.';

const vlink: KnownAdapter = {
  slug: 'ios-vlink__elm327-v2-2',
  nameHints: ['ios-vlink'],
  firmware: 'ELM327 v2.2',
  link: 'ble',
  reports: 3,
  typicalGrade: 'good',
  medianMs: 27.6,
  cloneSuspectedRatio: 0,
};
const vlinkOld: KnownAdapter = {
  ...vlink,
  slug: 'ios-vlink__elm327-v2-1',
  firmware: 'ELM327 v2.1',
  reports: 5,
  typicalGrade: 'ok',
};
const obd: KnownAdapter = {
  ...vlink,
  slug: 'obdii__elm327-v1-5',
  nameHints: ['obdii'],
  firmware: 'ELM327 v1.5',
  reports: 1,
  typicalGrade: 'poor',
  medianMs: null,
};
const LIST = [vlink, vlinkOld, obd];

describe('KNOWN_ADAPTERS', () => {
  it('is the generated knownAdapters.json', () => {
    expect(KNOWN_ADAPTERS).toEqual(committed);
  });
});

describe('matchKnownAdapter', () => {
  it('matches the advertised name case-insensitively', () => {
    expect(matchKnownAdapter('obdii', null, LIST)).toBe(obd);
    expect(matchKnownAdapter('  OBDII ', undefined, LIST)).toBe(obd);
  });

  it('breaks a name tie by firmware, else by report count', () => {
    expect(matchKnownAdapter('IOS-Vlink', 'ELM327 v2.2', LIST)).toBe(vlink);
    expect(matchKnownAdapter('IOS-Vlink', 'elm327 V2.1', LIST)).toBe(vlinkOld);
    expect(matchKnownAdapter('IOS-Vlink', null, LIST)).toBe(vlinkOld);
    expect(matchKnownAdapter('IOS-Vlink', 'ELM327 v9', LIST)).toBe(vlinkOld);
  });

  it('returns null for no name or no match, never a partial match', () => {
    expect(matchKnownAdapter(null, 'ELM327 v2.2', LIST)).toBeNull();
    expect(matchKnownAdapter('', null, LIST)).toBeNull();
    expect(matchKnownAdapter('Vlink', null, LIST)).toBeNull();
    expect(matchKnownAdapter('OBDII-2', null, LIST)).toBeNull();
  });

  it('never matches a connect-flow stand-in name, even if a report carried one', () => {
    const wifi: KnownAdapter = { ...obd, slug: 'wi-fi-elm327__x', nameHints: ['wi-fi elm327'] };
    expect(matchKnownAdapter('Wi-Fi ELM327', 'ELM327 v1.5', [...LIST, wifi])).toBeNull();
    expect(matchKnownAdapter('Bluetooth LE adapter', null, LIST)).toBeNull();
  });

  it('defaults to the bundled list', () => {
    const hit = KNOWN_ADAPTERS[0];
    if (hit) expect(matchKnownAdapter(hit.nameHints[0], hit.firmware)).toBe(hit);
    else expect(matchKnownAdapter('IOS-Vlink')).toBeNull(); // no community reports committed yet
  });
});

describe('communitySummary / knownAdapterChip', () => {
  it('summarises reports, grade and latency', () => {
    expect(communitySummary(vlink)).toBe('3 community reports · typically GOOD · ~28 ms');
    expect(communitySummary(obd)).toBe('1 community report · typically POOR');
    expect(knownAdapterChip(vlink)).toBe('known good');
    expect(knownAdapterChip(obd)).toBe('known poor');
  });
});
