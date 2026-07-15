import { diffScans } from './scanDiff';
import type { SavedScan, SavedScanModule, SavedScanDtc } from '../model/scanHistoryStore';

const dtc = (sae: string, vag = '', desc = ''): SavedScanDtc => ({
  sae,
  display: `${sae} 00`,
  vagCode: vag,
  description: desc,
  status: 0x08,
});

const mod = (address: string, over: Partial<SavedScanModule> = {}): SavedScanModule => ({
  address,
  name: `Module ${address}`,
  state: 'ok',
  dtcs: [],
  ...over,
});

const scan = (ts: number, modules: SavedScanModule[]): SavedScan => ({
  id: `s-${ts}`,
  ts,
  vehicle: { id: 'v', label: 'V', vin: null },
  protocol: 'CAN',
  modules,
});

describe('diffScans', () => {
  it('detects faults that appeared and cleared per module', () => {
    const before = scan(1, [mod('01', { dtcs: [dtc('P2183', '08579'), dtc('P2015', '08213')] })]);
    const after = scan(2, [mod('01', { dtcs: [dtc('P2183', '08579'), dtc('P0401', '01025')] })]);
    const d = diffScans(before, after);
    const m = d.modules.find((x) => x.address === '01')!;
    expect(m.status).toBe('changed');
    expect(m.faultsAppeared.map((f) => f.sae)).toEqual(['P0401']);
    expect(m.faultsCleared.map((f) => f.sae)).toEqual(['P2015']);
    expect(d.totals).toMatchObject({ appeared: 1, cleared: 1 });
  });

  it('flags coding and part-number changes', () => {
    const before = scan(1, [mod('09', { coding: '01 00 10 00', partNumber: '1K0937087' })]);
    const after = scan(2, [mod('09', { coding: '03 00 10 00', partNumber: '1K0937088' })]);
    const m = diffScans(before, after).modules.find((x) => x.address === '09')!;
    expect(m.status).toBe('changed');
    expect(m.codingChanged).toEqual({ before: '01 00 10 00', after: '03 00 10 00' });
    expect(m.partNumberChanged).toEqual({ before: '1K0937087', after: '1K0937088' });
  });

  it('reports added and removed modules', () => {
    const before = scan(1, [mod('01'), mod('03', { dtcs: [dtc('C0130')] })]);
    const after = scan(2, [mod('01'), mod('17')]); // 03 gone, 17 new
    const d = diffScans(before, after);
    expect(d.modules.find((m) => m.address === '17')!.status).toBe('added');
    const removed = d.modules.find((m) => m.address === '03')!;
    expect(removed.status).toBe('removed');
    expect(removed.faultsCleared.map((f) => f.sae)).toEqual(['C0130']); // its faults counted as cleared
    expect(d.totals).toMatchObject({ modulesAdded: 1, modulesRemoved: 1 });
  });

  it('marks an identical module unchanged', () => {
    const a = scan(1, [mod('01', { dtcs: [dtc('P2183')], coding: 'AA' })]);
    const b = scan(2, [mod('01', { dtcs: [dtc('P2183')], coding: 'AA' })]);
    const m = diffScans(a, b).modules[0];
    expect(m.status).toBe('unchanged');
    expect(m.faultsAppeared).toEqual([]);
    expect(m.faultsCleared).toEqual([]);
  });

  it('orders the newer scan first, then removed modules, and keeps the timestamps', () => {
    const d = diffScans(scan(10, [mod('03')]), scan(20, [mod('01')]));
    expect(d.modules.map((m) => m.address)).toEqual(['01', '03']); // newer (01) first, removed (03) last
    expect(d.fromTs).toBe(10);
    expect(d.toTs).toBe(20);
  });
});
