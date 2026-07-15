import {
  buildCarBackup,
  diffBackupModule,
  summarizeCarBackup,
  type CarBackupModule,
} from './carBackup';

const vehicle = { id: 'golf-plus-2009-20tdi', label: 'VW Golf Plus', vin: 'WVWZZZ1KZ9W903398' };

describe('buildCarBackup', () => {
  it('fills id/ts and derives coding hex, defaulting adaptations to []', () => {
    const snap = buildCarBackup({
      vehicle,
      protocol: 'ISO 15765-4 CAN',
      ts: 1700000000000,
      id: 'fixed-id',
      modules: [
        {
          reqHeader: '70E',
          address: '09',
          name: 'Central electrics (BCM)',
          coding: { did: 'F1A0', bytes: [0x01, 0x00, 0x10, 0x00] },
        },
        {
          reqHeader: '7E0',
          address: '01',
          name: 'Engine (EDC17)',
          partNumber: '03L906022LM',
          adaptations: [{ did: '3001', name: 'Idle speed offset', unit: 'rpm', raw: [0x03, 0x52], value: 850 }],
        },
      ],
    });

    expect(snap.id).toBe('fixed-id');
    expect(snap.ts).toBe(1700000000000);
    expect(snap.vehicle.vin).toBe('WVWZZZ1KZ9W903398');
    expect(snap.modules[0].coding).toEqual({ did: 'F1A0', bytes: [0x01, 0x00, 0x10, 0x00], hex: '01 00 10 00' });
    expect(snap.modules[0].adaptations).toEqual([]);
    expect(snap.modules[1].coding).toBeNull();
    expect(snap.modules[1].adaptations[0].value).toBe(850);
  });

  it('generates an id and timestamp when omitted', () => {
    const snap = buildCarBackup({ vehicle, protocol: 'CAN', modules: [] });
    expect(snap.id).toBeTruthy();
    expect(snap.ts).toBeGreaterThan(0);
  });

  it('copies coding + adaptation raw arrays (no shared references)', () => {
    const bytes = [0x01, 0x02];
    const raw = [0x03, 0x52];
    const snap = buildCarBackup({
      vehicle,
      protocol: 'CAN',
      modules: [{ reqHeader: '70E', name: 'BCM', coding: { did: 'F1A0', bytes }, adaptations: [{ did: '3001', name: 'x', raw, value: 1 }] }],
    });
    bytes[0] = 0xff;
    raw[0] = 0xff;
    expect(snap.modules[0].coding?.bytes[0]).toBe(0x01);
    expect(snap.modules[0].adaptations[0].raw?.[0]).toBe(0x03);
  });
});

describe('diffBackupModule', () => {
  const from: CarBackupModule = {
    reqHeader: '70E',
    name: 'BCM',
    coding: { did: 'F1A0', bytes: [0x01, 0x00, 0x10, 0x00], hex: '01 00 10 00' },
    adaptations: [{ did: '3001', name: 'Idle', raw: [0x03, 0x52], value: 850 }],
  };

  it('reports the changed coding bytes and adaptation deltas', () => {
    const to: CarBackupModule = {
      reqHeader: '70E',
      name: 'BCM',
      coding: { did: 'F1A0', bytes: [0x01, 0x00, 0x13, 0x00], hex: '01 00 13 00' },
      adaptations: [{ did: '3001', name: 'Idle', raw: [0x03, 0x84], value: 900 }],
    };
    const d = diffBackupModule(from, to);
    expect(d.codingChanged?.changedBytes).toEqual([2]);
    expect(d.codingChanged?.before).toBe('01 00 10 00');
    expect(d.codingChanged?.after).toBe('01 00 13 00');
    expect(d.adaptationDeltas).toEqual([{ did: '3001', name: 'Idle', before: 850, after: 900 }]);
  });

  it('returns no coding change and no deltas for identical modules', () => {
    const d = diffBackupModule(from, from);
    expect(d.codingChanged).toBeUndefined();
    expect(d.adaptationDeltas).toEqual([]);
  });
});

describe('summarizeCarBackup', () => {
  it('counts modules, coded modules and adaptation channels', () => {
    const snap = buildCarBackup({
      vehicle,
      protocol: 'CAN',
      modules: [
        { reqHeader: '70E', name: 'BCM', coding: { did: 'F1A0', bytes: [0x01] } },
        { reqHeader: '7E0', name: 'Engine', adaptations: [
          { did: '3001', name: 'a', raw: [0x00], value: 0 },
          { did: '3002', name: 'b', raw: [0x00], value: 0 },
        ] },
      ],
    });
    expect(summarizeCarBackup(snap)).toEqual({ modules: 2, codedModules: 1, adaptations: 2 });
  });
});
