/** End-to-end: a Golf Plus coding preset compiled to the gated coding write, driven against the
 *  simulated car (MockTransport + DiagnosticSession + codeModule) — the exact engine path the
 *  Tweaks UI uses. Proves the shipped presets round-trip in the simulator (apply → write → verify,
 *  then revert), and that current-state detection reads the seeded coding. */
import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { codeModule } from './udsCoding';
import { applyPreset, revertPreset, detectPresetState } from './presets';
import { getVehicleProfile } from '../../vehicles';

describe('coding presets against the simulated Golf', () => {
  const profile = getVehicleProfile('golf-plus-2009-20tdi');
  const bcm = profile.codingModules!.find((m) => m.reqHeader === '70E')!;
  const presets = profile.codingPresets!;

  async function golfSession() {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await session.connect();
    return session;
  }

  async function readCoding(session: DiagnosticSession): Promise<number[]> {
    await session.setHeader(bcm.reqHeader);
    await session.setRxFilter(bcm.rxFilter);
    const bytes = (await session.readExtended(bcm.codingDid)) ?? [];
    await session.resetAddressing();
    return bytes;
  }

  it('ships presets that all target the codeable BCM', () => {
    expect(presets.length).toBeGreaterThanOrEqual(2);
    for (const p of presets) expect(p.reqHeader).toBe(bcm.reqHeader);
  });

  it('detects the shipped presets current state from the seeded coding', async () => {
    const session = await golfSession();
    const coding = await readCoding(session); // [01 00 10 00]
    const drl = presets.find((p) => p.id === 'golf-drl')!;
    const needle = presets.find((p) => p.id === 'golf-needle-sweep')!;
    const blink = presets.find((p) => p.id === 'golf-comfort-blink')!;
    expect(detectPresetState(coding, drl)).toBe('on'); // byte0 bit0 set in the sample
    expect(detectPresetState(coding, needle)).toBe('off'); // byte1 bit0 clear
    expect(detectPresetState(coding, blink)).toBe('off'); // byte2 low nibble 0
  });

  it('applies the needle-sweep preset through the gated write and verifies, then reverts', async () => {
    const session = await golfSession();
    const send = (cmd: string) => session.send(cmd);
    const needle = presets.find((p) => p.id === 'golf-needle-sweep')!;

    await session.setHeader(bcm.reqHeader);
    await session.setRxFilter(bcm.rxFilter);
    const before = (await session.readExtended(bcm.codingDid)) ?? [];
    const wrote = await codeModule(send, { did: bcm.codingDid, newData: applyPreset(before, needle) });
    await session.resetAddressing();

    expect(wrote.verified).toBe(true);
    expect(wrote.backup).toEqual([0x01, 0x00, 0x10, 0x00]);
    expect(detectPresetState(await readCoding(session), needle)).toBe('on');

    // Revert restores the off state and re-verifies.
    await session.setHeader(bcm.reqHeader);
    await session.setRxFilter(bcm.rxFilter);
    const now = (await session.readExtended(bcm.codingDid)) ?? [];
    const reverted = await codeModule(send, { did: bcm.codingDid, newData: revertPreset(now, needle) });
    await session.resetAddressing();
    expect(reverted.verified).toBe(true);
    expect(detectPresetState(await readCoding(session), needle)).toBe('off');
  });

  it('round-trips the masked comfort-blink preset (low nibble) without disturbing the high nibble', async () => {
    const session = await golfSession();
    const send = (cmd: string) => session.send(cmd);
    const blink = presets.find((p) => p.id === 'golf-comfort-blink')!;

    await session.setHeader(bcm.reqHeader);
    await session.setRxFilter(bcm.rxFilter);
    const before = (await session.readExtended(bcm.codingDid)) ?? []; // [01 00 10 00]
    const res = await codeModule(send, { did: bcm.codingDid, newData: applyPreset(before, blink) });
    await session.resetAddressing();

    expect(res.verified).toBe(true);
    const after = await readCoding(session);
    expect(after[2]).toBe(0x13); // low nibble 3, high nibble 1 preserved
    expect(detectPresetState(after, blink)).toBe('on');
  });
});
