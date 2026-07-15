import { searchScan } from './scanSearch';
import type { SavedScanModule } from '../model/scanHistoryStore';

const modules: SavedScanModule[] = [
  {
    address: '01',
    name: 'Engine (EDC17)',
    state: 'ok',
    dtcs: [
      { sae: 'P2183', display: 'P2183 00', vagCode: '08579', description: 'Engine coolant temperature sensor 2', status: 0x09 },
      { sae: 'P0121', display: 'P0121 00', vagCode: '00289', description: 'Throttle/pedal position sensor', status: 0x04 },
    ],
  },
  {
    address: '03',
    name: 'ABS/ESP (MK60)',
    state: 'ok',
    dtcs: [{ sae: 'C0130', display: 'C0130 00', vagCode: '', description: 'ABS hydraulic pump', status: 0x88 }],
  },
  { address: '17', name: 'Instrument cluster', state: 'ok', dtcs: [] },
];

describe('searchScan', () => {
  it('matches by VAG 5-digit number', () => {
    const hits = searchScan(modules, '08579');
    expect(hits).toHaveLength(1);
    expect(hits[0].address).toBe('01');
    expect(hits[0].dtcs.map((d) => d.sae)).toEqual(['P2183']);
  });

  it('matches a VAG number with leading zeros dropped', () => {
    expect(searchScan(modules, '8579')[0].dtcs[0].sae).toBe('P2183');
  });

  it('matches by SAE / OBD2 code, with or without failure-type suffix', () => {
    expect(searchScan(modules, 'P0121')[0].dtcs[0].vagCode).toBe('00289');
    expect(searchScan(modules, 'p0121 00')[0].dtcs[0].sae).toBe('P0121');
  });

  it('matches an engine OBD2 code present in the scan', () => {
    const hits = searchScan(modules, 'C0130');
    expect(hits[0].address).toBe('03');
  });

  it('matches by fault-text substring, case-insensitive', () => {
    const hits = searchScan(modules, 'throttle');
    expect(hits).toHaveLength(1);
    expect(hits[0].dtcs[0].sae).toBe('P0121');
  });

  it('narrows each module to only the matching faults', () => {
    const hits = searchScan(modules, 'sensor'); // matches both engine faults, none in ABS
    expect(hits).toHaveLength(1);
    expect(hits[0].dtcs).toHaveLength(2);
  });

  it('returns [] for an empty query and for no matches', () => {
    expect(searchScan(modules, '   ')).toEqual([]);
    expect(searchScan(modules, 'P9999')).toEqual([]);
  });
});
