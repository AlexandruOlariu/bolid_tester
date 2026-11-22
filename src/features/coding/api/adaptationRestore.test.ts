import type { AdaptationChannel } from '@/shared/vehicles';
import { diffBackupModule, type CarBackupModule } from './carBackup';
import {
  currentModuleFromReads,
  planAdaptationRestore,
  restoreHeadline,
  summarizeRestorePlan,
} from './adaptationRestore';

const idle: AdaptationChannel = {
  module: 'Engine (EDC17)',
  reqHeader: '7E0',
  rxFilter: '7E8',
  did: '3001',
  name: 'Idle speed offset',
  unit: 'rpm',
  byteCount: 2,
  min: 750,
  max: 950,
  experimental: true,
  sampleValue: [0x03, 0x52],
};
const egr: AdaptationChannel = {
  module: 'Engine (EDC17)',
  reqHeader: '7E0',
  rxFilter: '7E8',
  did: '3002',
  name: 'EGR base duty',
  unit: '%',
  byteCount: 1,
  scale: 0.5,
  min: 0,
  max: 100,
  experimental: true,
  sampleValue: [0x64],
};

function snapshot(
  adaptations: CarBackupModule['adaptations'],
  extra: Partial<CarBackupModule> = {},
): CarBackupModule {
  return { reqHeader: '7E0', name: 'Engine (EDC17)', coding: null, adaptations, ...extra };
}
const snap = (did: string, raw: number[] | null, value: number | null, name = did) => ({
  did,
  name,
  raw,
  value,
});

describe('planAdaptationRestore', () => {
  it('plans a restore when the car differs and the snapshot is in bounds', () => {
    const [item] = planAdaptationRestore(snapshot([snap('3001', [0x03, 0x52], 850)]), [idle], {
      '3001': [0x03, 0x84],
    });
    expect(item).toMatchObject({
      did: '3001',
      name: 'Idle speed offset',
      unit: 'rpm',
      action: 'restore',
      snapshotRaw: [0x03, 0x52],
      snapshotValue: 850,
      currentRaw: [0x03, 0x84],
      currentValue: 900,
    });
    expect(item.skip).toBeUndefined();
    expect(item.channel).toBe(idle);
  });

  it('skips as equal on byte-identical current and snapshot', () => {
    const [item] = planAdaptationRestore(snapshot([snap('3002', [0x64], 50)]), [egr], {
      '3002': [0x64],
    });
    expect(item).toMatchObject({ action: 'skip', skip: 'equal', currentValue: 50 });
  });

  it('restores when the current read failed (nothing to prove it equal)', () => {
    const [item] = planAdaptationRestore(snapshot([snap('3002', [0x64], 50)]), [egr], {});
    expect(item).toMatchObject({ action: 'restore', currentRaw: null, currentValue: null });
  });

  it('skips a channel the live profile no longer declares (no-channel)', () => {
    const items = planAdaptationRestore(
      snapshot([snap('30FF', [0x01], 1, 'Old channel')]),
      [idle, egr],
      {
        '30FF': [0x02],
      },
    );
    expect(items[0]).toMatchObject({
      action: 'skip',
      skip: 'no-channel',
      channel: null,
      name: 'Old channel',
    });
  });

  it('matches channels by request header too', () => {
    const otherModule = { ...idle, reqHeader: '70E' };
    const [item] = planAdaptationRestore(
      snapshot([snap('3001', [0x03, 0x52], 850)]),
      [otherModule],
      {},
    );
    expect(item.skip).toBe('no-channel');
  });

  it('skips a channel the backup could not read (no-snapshot-raw)', () => {
    const [item] = planAdaptationRestore(snapshot([snap('3001', null, null)]), [idle], {
      '3001': [0x03, 0x84],
    });
    expect(item).toMatchObject({ action: 'skip', skip: 'no-snapshot-raw' });
  });

  it('refuses an out-of-bounds snapshot value with the bounds message, never clamping', () => {
    const [item] = planAdaptationRestore(snapshot([snap('3001', [0x04, 0x00], 1024)]), [idle], {
      '3001': [0x03, 0x84],
    });
    expect(item).toMatchObject({
      action: 'skip',
      skip: 'out-of-bounds',
      reason: 'Value 1024 rpm is above the channel maximum (950).',
      snapshotRaw: [0x04, 0x00],
    });
  });

  it('refuses a snapshot raw of the wrong width as out of bounds', () => {
    const [item] = planAdaptationRestore(snapshot([snap('3001', [0x52], 82)]), [idle], {});
    expect(item.skip).toBe('out-of-bounds');
  });

  it('locks a security channel unless it is unlockable', () => {
    const secured = { ...idle, security: { level: 3 } };
    const module = snapshot([snap('3001', [0x03, 0x52], 850)]);
    const current = { '3001': [0x03, 0x84] };
    expect(planAdaptationRestore(module, [secured], current)[0]).toMatchObject({
      action: 'skip',
      skip: 'locked',
    });
    expect(
      planAdaptationRestore(module, [secured], current, { unlockable: () => false })[0].skip,
    ).toBe('locked');
    expect(
      planAdaptationRestore(module, [secured], current, { unlockable: () => true })[0].action,
    ).toBe('restore');
  });

  it('checks bounds before the lock (an out-of-bounds value is never offered even when unlockable)', () => {
    const secured = { ...idle, security: { level: 3 } };
    const [item] = planAdaptationRestore(
      snapshot([snap('3001', [0x04, 0x00], 1024)]),
      [secured],
      {},
      {
        unlockable: () => true,
      },
    );
    expect(item.skip).toBe('out-of-bounds');
  });
});

describe('summarizeRestorePlan', () => {
  it('counts restores and every skip reason', () => {
    const items = planAdaptationRestore(
      snapshot([
        snap('3001', [0x03, 0x52], 850),
        snap('3002', [0x64], 50),
        snap('30FF', [0x01], 1),
        snap('3003', null, null),
        snap('3004', [0x04, 0x00], 1024),
      ]),
      [idle, egr, { ...idle, did: '3003' }, { ...idle, did: '3004' }],
      { '3001': [0x03, 0x84], '3002': [0x64] },
    );
    expect(summarizeRestorePlan(items)).toEqual({
      restore: 1,
      skipped: { equal: 1, 'no-channel': 1, 'no-snapshot-raw': 1, 'out-of-bounds': 1, locked: 0 },
    });
  });

  it('is all zeros for an empty plan', () => {
    expect(summarizeRestorePlan([])).toEqual({
      restore: 0,
      skipped: { equal: 0, 'no-channel': 0, 'no-snapshot-raw': 0, 'out-of-bounds': 0, locked: 0 },
    });
  });
});

describe('currentModuleFromReads + restoreHeadline', () => {
  const coding = { did: '0600', bytes: [0x01, 0x00], hex: '01 00' };
  const module = snapshot([snap('3001', [0x03, 0x52], 850), snap('3002', [0x64], 50)], { coding });
  const headline = (
    m: CarBackupModule,
    channels: AdaptationChannel[],
    reads: Record<string, number[]>,
  ) => {
    const now = currentModuleFromReads(m, channels, reads);
    const items = planAdaptationRestore(m, channels, reads);
    return restoreHeadline(m, now, diffBackupModule(m, now), items);
  };

  it('reports differing adaptations and unchanged coding', () => {
    const now = currentModuleFromReads(module, [idle, egr], {
      '3001': [0x03, 0x84],
      '3002': [0x66],
      '0600': [0x01, 0x00],
    });
    expect(now.adaptations.map((a) => a.value)).toEqual([900, 51]);
    expect(now.coding?.hex).toBe('01 00');
    expect(
      headline(module, [idle, egr], { '3001': [0x03, 0x84], '3002': [0x66], '0600': [0x01, 0x00] }),
    ).toBe('2 adaptations differ, coding unchanged');
  });

  it('reports one difference, changed coding, and a coding read that failed', () => {
    expect(
      headline(module, [idle, egr], { '3001': [0x03, 0x84], '3002': [0x64], '0600': [0x01, 0x01] }),
    ).toBe('1 adaptation differs, coding changed');
    const unread = currentModuleFromReads(module, [idle, egr], {
      '3001': [0x03, 0x52],
      '3002': [0x64],
    });
    expect(unread.coding).toBeNull();
    expect(headline(module, [idle, egr], { '3001': [0x03, 0x52], '3002': [0x64] })).toBe(
      'Adaptations match the backup, coding not read',
    );
  });

  it('agrees with the rows: a channel dropped from the profile is not compared, not a difference', () => {
    // 3002 is no longer declared; 3001 is equal → nothing to restore, and the headline says so.
    const m = snapshot([snap('3001', [0x03, 0x52], 850), snap('3002', [0x64], 50)]);
    expect(headline(m, [idle], { '3001': [0x03, 0x52] })).toBe(
      'No adaptation differs, 1 not compared',
    );
  });

  it('counts a failed live read and a channel the backup missed as not compared', () => {
    const m = snapshot([snap('3001', [0x03, 0x52], 850), snap('3002', null, null)]);
    // 3001 did not answer now; 3002 was never in the backup but reads fine now.
    expect(headline(m, [idle, egr], { '3002': [0x64] })).toBe(
      'No adaptation differs, 2 not compared',
    );
    expect(headline(m, [idle, egr], { '3001': [0x03, 0x84], '3002': [0x64] })).toBe(
      '1 adaptation differs, 1 not compared',
    );
  });

  it('compares bytes, not stored decoded values (identical bytes match despite a stale value)', () => {
    // The snapshot's stored value (900) is stale, but its bytes equal the car's — the row is equal.
    const m = snapshot([snap('3001', [0x03, 0x52], 900)]);
    expect(headline(m, [idle], { '3001': [0x03, 0x52] })).toBe('Adaptations match the backup');
  });
});
