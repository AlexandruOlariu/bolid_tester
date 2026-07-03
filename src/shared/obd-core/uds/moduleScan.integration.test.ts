/** End-to-end: module scan primitives against the simulated Golf (MockTransport + DiagnosticSession),
 *  exactly the path the module-scan feature uses. Validates the simulator's 0x19/0x14 handlers,
 *  scenario seeding from profile.modules, and header-scoped ident DIDs. */
import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';
import { readModuleDtcs, clearModuleDtcs, readModuleIdent, readDtcSnapshot } from './udsModule';

describe('module scan against the simulated Golf', () => {
  async function golfSession() {
    const transport = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
    const session = new DiagnosticSession(transport);
    await session.connect();
    return session;
  }

  it('reads engine ident + DTCs via 7E0, then clears them', async () => {
    const session = await golfSession();
    const send = (cmd: string) => session.send(cmd);
    await session.setHeader('7E0');

    const ident = await readModuleIdent(send);
    expect(ident.partNumber).toBe('03L906022LM');
    expect(ident.systemName).toContain('EDC');

    const all = await readModuleDtcs(send, 0xff);
    expect(all.map((d) => d.sae).sort()).toEqual(['P0121', 'P2015', 'P2183']);
    const stored = await readModuleDtcs(send); // default mask 0x09
    expect(stored.map((d) => d.sae).sort()).toEqual(['P2015', 'P2183']);
    expect(stored.find((d) => d.sae === 'P2183')?.vagCode).toBe('08579');

    const snap = await readDtcSnapshot(send, [0x21, 0x83, 0x00]);
    expect(snap.slice(0, 3)).toEqual([0x21, 0x83, 0x00]);

    await clearModuleDtcs(send);
    expect(await readModuleDtcs(send, 0xff)).toEqual([]);
    await session.setHeader(null);
  });

  it('reads the ABS module on its own header and leaves other modules alone', async () => {
    const session = await golfSession();
    const send = (cmd: string) => session.send(cmd);

    await session.setHeader('760');
    const abs = await readModuleDtcs(send, 0xff);
    expect(abs).toHaveLength(1);
    expect(abs[0].sae).toBe('C0130');
    expect(abs[0].statusFlags.warningIndicator).toBe(true);

    // Cluster is seeded clean but answers ident.
    await session.setHeader('714');
    expect(await readModuleDtcs(send, 0xff)).toEqual([]);
    const ident = await readModuleIdent(send);
    expect(ident.systemName).toBe('KOMBIINSTRUMENT');
    await session.setHeader(null);
  });

  it('returns nothing for modules the car does not have', async () => {
    const session = await golfSession();
    await session.setHeader('7B0');
    await expect(readModuleDtcs((cmd) => session.send(cmd), 0xff)).rejects.toThrow(/No response/);
    await session.setHeader(null);
  });

  // Regression guard for the field bug the simulator used to hide: module-scoped work must
  // restore BOTH the header and the ATCRA receive filter, or every later standard read dies.
  it('standard reads keep working after module-scoped work (addressing fully restored)', async () => {
    const session = await golfSession();
    await session.setHeader('760');
    await session.setRxFilter('768');
    await readModuleDtcs((cmd) => session.send(cmd), 0xff);
    await session.resetAddressing();
    const rpm = await session.readValue('010C');
    expect(rpm?.value ?? 0).toBeGreaterThan(0);
  });

  it('a STALE rx filter blocks standard reads, like on a real adapter', async () => {
    const session = await golfSession();
    await session.setHeader('760');
    await session.setRxFilter('768');
    await session.setHeader(null); // header restored but the filter forgotten — the old bug
    expect(await session.readValue('010C')).toBeNull();
  });
});
