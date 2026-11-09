/** End-to-end adaptation restore (plan 24) against the simulated Golf: the exact engine path the
 *  backup screen uses — read channels with `readChannel`, plan with `planAdaptationRestore`, write
 *  the plan's items through the gated `writeChannel` (backup → write → verify), re-read. Also proves
 *  an out-of-bounds snapshot value is refused by both the planner and the write guard. */
import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { decodeAdaptationRaw } from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import { readChannel, writeChannel } from '@/features/adaptations/api/adaptationService';
import { buildCarBackup } from './carBackup';
import { planAdaptationRestore, summarizeRestorePlan } from './adaptationRestore';

describe('adaptation restore against the simulated Golf', () => {
  const profile = getVehicleProfile('golf-plus-2009-20tdi');
  const channels = (profile.adaptations ?? []).filter((c) => c.reqHeader === '7E0');
  const ch3001 = channels.find((c) => c.did === '3001')!;
  const ch3002 = channels.find((c) => c.did === '3002')!;

  async function golfSession() {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await session.connect();
    return session;
  }

  async function snapshotModule(session: DiagnosticSession) {
    const adaptations = [];
    for (const ch of channels) {
      const raw = await readChannel(session, ch);
      adaptations.push({
        did: ch.did,
        name: ch.name,
        unit: ch.unit,
        raw,
        value: raw ? decodeAdaptationRaw(raw, ch) : null,
      });
    }
    return buildCarBackup({
      vehicle: { id: profile.id, label: 'Golf', vin: null },
      protocol: 'CAN',
      modules: [{ reqHeader: '7E0', name: 'Engine (EDC17)', adaptations }],
    }).modules[0];
  }

  it('restores a changed channel to the backed-up value and leaves the equal one alone', async () => {
    const session = await golfSession();

    // 1–2. Read the seeded value and snapshot it.
    expect(await readChannel(session, ch3001)).toEqual([0x03, 0x52]); // 850 rpm
    const snapshot = await snapshotModule(session);
    expect(snapshot.adaptations.map((a) => a.value)).toEqual([850, 50]);

    // 3. Change 3001 to 900 rpm through the gated write.
    const changed = await writeChannel(session, ch3001, [0x03, 0x84]);
    expect(changed.ok).toBe(true);
    expect(changed.backup).toEqual([0x03, 0x52]);
    expect(await readChannel(session, ch3001)).toEqual([0x03, 0x84]);

    // 4. Plan against a fresh read.
    const current = {
      '3001': (await readChannel(session, ch3001)) ?? undefined,
      '3002': (await readChannel(session, ch3002)) ?? undefined,
    };
    expect(current).toEqual({ '3001': [0x03, 0x84], '3002': [0x64] });
    const items = planAdaptationRestore(snapshot, channels, current);
    expect(items.map((i) => [i.did, i.action, i.skip])).toEqual([
      ['3001', 'restore', undefined],
      ['3002', 'skip', 'equal'],
    ]);
    expect(items[0]).toMatchObject({ snapshotValue: 850, currentValue: 900 });
    expect(summarizeRestorePlan(items).restore).toBe(1);

    // 5. Execute the restore item: verified, and the car reads 850 again.
    const item = items[0];
    const restored = await writeChannel(session, item.channel!, item.snapshotRaw!);
    expect(restored).toMatchObject({ ok: true, backup: [0x03, 0x84] });
    expect(await readChannel(session, ch3001)).toEqual([0x03, 0x52]);

    // A second compare finds nothing left to do.
    const again = planAdaptationRestore(snapshot, channels, {
      '3001': (await readChannel(session, ch3001)) ?? undefined,
      '3002': (await readChannel(session, ch3002)) ?? undefined,
    });
    expect(again.every((i) => i.skip === 'equal')).toBe(true);
  });

  it('refuses an out-of-bounds snapshot value in the planner and in writeChannel', async () => {
    const session = await golfSession();
    const snapshot = await snapshotModule(session);
    // 1024 rpm — above the channel maximum of 950, e.g. from an older, looser profile revision.
    snapshot.adaptations[0] = { ...snapshot.adaptations[0], raw: [0x04, 0x00], value: 1024 };

    const [item] = planAdaptationRestore(snapshot, channels, { '3001': [0x03, 0x52] });
    expect(item).toMatchObject({
      action: 'skip',
      skip: 'out-of-bounds',
      reason: 'Value 1024 rpm is above the channel maximum (950).',
    });

    const res = await writeChannel(session, ch3001, [0x04, 0x00]);
    expect(res).toEqual({
      ok: false,
      message: 'Value 1024 rpm is above the channel maximum (950).',
    });
    expect(await readChannel(session, ch3001)).toEqual([0x03, 0x52]); // untouched
  });
});
