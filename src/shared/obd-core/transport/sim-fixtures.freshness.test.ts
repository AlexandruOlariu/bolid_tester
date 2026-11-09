/** The committed simulator fixtures (`fixtures/<id>/sim-<flow>.json`) must equal a fresh recording.
 *  Changing a vehicle profile, a scenario or the simulator turns this red until
 *  `npm run fixtures:sim` regenerates the files (then commit them). */
import { readFixtureFiles } from './fixtureFiles';
import { recordAllSimFixtures, recordSimFixture, serializeFixture } from './simFixtures';
import { ReplayFixture } from './logReplay';

const HINT = 'run `npm run fixtures:sim` and commit the result';

describe('simulator fixtures are fresh', () => {
  // Re-recording every vehicle × flow takes ~5 s on its own — jest's default per-test limit — so it
  // timed out under a loaded full run. The margin is for that, not for a hang.
  it('every committed sim-*.json equals a fresh recording, and none is missing or stale', async () => {
    const fresh = await recordAllSimFixtures();
    const committed = Object.fromEntries(
      readFixtureFiles()
        .filter((f) => f.file.startsWith('sim-'))
        .map((f) => [f.rel, f.fixture] as const),
    );
    expect({ files: Object.keys(committed).sort(), hint: HINT }).toEqual({
      files: Object.keys(fresh).sort(),
      hint: HINT,
    });
    for (const [rel, fixture] of Object.entries(fresh)) {
      // Compare the parsed JSON so a CRLF checkout cannot fail it.
      const roundTripped = JSON.parse(serializeFixture(fixture)) as ReplayFixture;
      expect({ rel, fixture: committed[rel] }).toEqual({ rel, fixture: roundTripped });
    }
  }, 30_000);

  it('recording is deterministic, and a changed scenario value no longer matches', async () => {
    const committed = readFixtureFiles().find(
      (f) => f.rel === 'golf-plus-2009-20tdi/sim-connect.json',
    )?.fixture;
    const a = await recordSimFixture('golf-plus-2009-20tdi', 'connect');
    const b = await recordSimFixture('golf-plus-2009-20tdi', 'connect');
    expect(serializeFixture(a)).toBe(serializeFixture(b));
    expect(JSON.parse(serializeFixture(a))).toEqual(committed);

    // One scenario value changed (the VIN, as an edited profile would): the comparison above fails.
    const edited = await recordSimFixture('golf-plus-2009-20tdi', 'connect', {
      vin: 'WVWZZZ1KZ9W000001',
    });
    expect(JSON.parse(serializeFixture(edited))).not.toEqual(committed);
    expect(edited.pairs['0902']).not.toBe(committed?.pairs['0902']);
    expect(edited.expect?.vin).toBe('WVWZZZ1KZ9W000001');
  });
});
