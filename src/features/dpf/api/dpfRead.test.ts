import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { createReadOnlySession } from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import { dpfAvailable, readDpf } from './dpfRead';

async function sessionFor(profileId: string): Promise<DiagnosticSession> {
  const session = new DiagnosticSession(new MockTransport(buildScenario(profileId)), {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  await session.connect();
  return session;
}

const golf = getVehicleProfile('golf-plus-2009-20tdi');

describe('readDpf', () => {
  it('readDpf on the Golf decodes the DPF DIDs and assesses them', async () => {
    const golfSession = await sessionFor('golf-plus-2009-20tdi');
    const out = await readDpf(createReadOnlySession(golfSession), golf);
    expect(out?.report.status).toBeDefined();
    expect(out?.values.length).toBeGreaterThan(0);
    // Every DPF / diesel DID, decoded with its profile decoder, in profile order.
    expect(out?.values.map((v) => v.did)).toEqual(
      (golf.extendedPids ?? [])
        .filter((p) => p.category === 'dpf' || p.category === 'diesel')
        .map((p) => p.did),
    );
    expect(out?.values.map((v) => v.did)).not.toContain('1709'); // injection, not DPF
    expect(out?.values.find((v) => v.role === 'sootPct')?.value).toBe(55);
    expect(out?.report).toMatchObject({ status: 'filling', sootPct: 55 });
  });

  it('readDpf is null on the petrol Punto', async () => {
    const puntoSession = await sessionFor('fiat-punto-2008-12');
    expect(
      await readDpf(createReadOnlySession(puntoSession), getVehicleProfile('fiat-punto-2008-12')),
    ).toBeNull();
  });

  it('a DiagnosticSession satisfies the session it needs (the screen path)', async () => {
    const out = await readDpf(await sessionFor('golf-plus-2009-20tdi'), golf);
    expect(out?.report.status).toBe('filling');
  });

  it('is null on a petrol car that carries the Golf DPF DIDs, and off CAN', async () => {
    const petrolOnGolfBase = { ...golf, fuel: 'petrol' as const };
    const session = await sessionFor('golf-plus-2009-20tdi');
    expect(await readDpf(session, petrolOnGolfBase)).toBeNull();
    expect(dpfAvailable(golf, 'ISO_14230_4_KWP_FAST')).toBe(false);
    expect(dpfAvailable(golf, 'ISO_15765_4_CAN_11_500')).toBe(true);
    expect(dpfAvailable({ ...golf, extendedPids: [] }, 'ISO_15765_4_CAN_11_500')).toBe(false);
  });

  it('a DID with no answer reads as null and is left out of the assessment', async () => {
    const session = await sessionFor('golf-plus-2009-20tdi');
    const readExtended = async (did: string) => (did === '1702' ? null : session.readExtended(did));
    const out = await readDpf({ currentProtocol: session.currentProtocol, readExtended }, golf);
    expect(out?.values.find((v) => v.did === '1702')?.value).toBeNull();
    expect(out?.report.status).toBe('unknown');
  });
});
