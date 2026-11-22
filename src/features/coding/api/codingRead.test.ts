/** The read-only coding read the AI agent uses (plan 34b): `readCodingReadOnly` through the
 *  read-only facade over a real `DiagnosticSession` on the simulated Golf, with a logging wrapper so
 *  "only reads go out" is checked on the wire. */
import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { createReadOnlySession } from '@/shared/obd-core';
import { bytesToString } from '@/shared/lib/bytes';
import { findLabelPack } from '@/shared/labels';
import { getVehicleProfile } from '@/shared/vehicles';
import { readCodingReadOnly } from './codingRead';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const labels = findLabelPack;

async function golfConnected() {
  const mock = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
  const sent: string[] = [];
  const write = mock.write.bind(mock);
  mock.write = async (bytes: Uint8Array) => {
    sent.push(bytesToString(bytes).trim());
    return write(bytes);
  };
  const session = new DiagnosticSession(mock);
  await session.connect();
  sent.splice(0);
  return { session, mock, sent };
}

describe('readCodingReadOnly', () => {
  it('readCodingReadOnly decodes the Golf coding module', async () => {
    const { session: golfSession } = await golfConnected();
    const out = await readCodingReadOnly(
      createReadOnlySession(golfSession),
      golf.codingModules![0],
      labels,
    );
    expect(out?.hex).toMatch(/^[0-9A-F ]+$/);
    expect(out?.fields.length).toBeGreaterThan(0);
  });

  it('gives the coding hex and the schema fields merged with the label pack, decoded', async () => {
    const { session } = await golfConnected();
    const out = await readCodingReadOnly(
      createReadOnlySession(session),
      golf.codingModules![0],
      labels,
    );
    expect(out?.hex).toBe('01 00 10 00');
    expect(out?.fields).toEqual([
      { name: 'Daytime running lights', value: 'on' },
      { name: 'Coming-home lights', value: 'off' },
      { name: 'Needle sweep on start', value: 'off' },
      { name: 'One-touch turn signal blinks', value: '0' },
      // From the vag-bcm-pq35 label pack (the module's part number 1K0937…).
      { name: 'Leaving-home lights', value: 'off' },
      { name: 'Coming/leaving-home via light switch', value: 'off' },
      { name: 'Gong with key-in-ignition', value: 'off' },
      { name: 'Footwell lighting', value: 'off' },
    ]);
  });

  it('without a label pack it decodes the profile schema only', async () => {
    const { session } = await golfConnected();
    const out = await readCodingReadOnly(
      createReadOnlySession(session),
      golf.codingModules![0],
      () => null,
    );
    expect(out?.fields.map((f) => f.name)).toEqual(
      golf.codingModules![0].schema.map((f) => f.name),
    );
  });

  it('sends only the 22 read on the module header and restores addressing', async () => {
    const { session, sent } = await golfConnected();
    await readCodingReadOnly(createReadOnlySession(session), golf.codingModules![0], labels);
    expect(sent).toEqual(expect.arrayContaining(['ATSH70E', 'ATCRA77E', '22F1A0']));
    expect(sent.filter((c) => /^(10|2E|27|3B|2B)/i.test(c))).toEqual([]);
  });

  it('a module that does not answer reads as null', async () => {
    const { session, mock } = await golfConnected();
    mock.scenario.coding = {};
    expect(
      await readCodingReadOnly(createReadOnlySession(session), golf.codingModules![0], labels),
    ).toBeNull();
  });
});
