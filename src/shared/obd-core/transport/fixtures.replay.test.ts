/** Every committed replay fixture (`fixtures/<vehicleId>/<flow>.json`) is replayed through the real
 *  `DiagnosticSession` and must satisfy its `expect` block. Car fixtures (`meta.source: 'car'`)
 *  must also be listed in their vehicle doc's "Validated on the car" table. See docs/simulator.md
 *  → "Replay fixtures" and docs/testing.md → "Recording results". */
import * as fs from 'fs';
import * as path from 'path';
import { readFixtureFiles } from './fixtureFiles';
import { checkReplayFixture } from './fixtureCheck';
import { ReplayFixture, ReplayFixtureExpect } from './logReplay';
import { VEHICLE_REGISTRY } from '../../vehicles';
import { parseValidatedOnTable } from '../../vehicles/validatedOn';

const DOCS_DIR = path.resolve(__dirname, '../../../../docs/vehicles');
const files = readFixtureFiles();

describe('committed replay fixtures', () => {
  it('the simulator fixtures are present for every registry profile', () => {
    const rels = new Set(files.map((f) => f.rel));
    for (const id of Object.keys(VEHICLE_REGISTRY)) {
      for (const flow of ['connect', 'faults', 'clear']) {
        expect(rels.has(`${id}/sim-${flow}.json`)).toBe(true);
      }
    }
  });

  for (const { rel, vehicleDir, file, fixture } of files) {
    describe(rel, () => {
      it('is well formed and filed under its vehicle', () => {
        expect(typeof fixture.pairs).toBe('object');
        expect(fixture.meta?.vehicleId).toBe(vehicleDir);
        expect(fixture.meta?.flow).toBeTruthy();
        expect(['simulator', 'car']).toContain(fixture.meta?.source);
        // `sim-*` is reserved for recorded simulator output, so it can never pass for validation.
        expect(fixture.meta?.source === 'simulator').toBe(file.startsWith('sim-'));
        expect(fixture.expect).toBeDefined();
      });

      it('replays to its expectations', async () => {
        expect(await checkReplayFixture(fixture)).toEqual([]);
      });

      if (fixture.meta?.source === 'car') {
        it('is listed in the vehicle doc’s "Validated on the car" table', () => {
          const doc = path.join(DOCS_DIR, `${vehicleDir}.md`);
          expect(fs.existsSync(doc)).toBe(true);
          const rows = parseValidatedOnTable(fs.readFileSync(doc, 'utf8')) ?? [];
          expect(rows.flatMap((r) => r.fixtures)).toContain(file);
        });
      }
    });
  }

  it('a wrong expectation is reported, not silently passed — every expectation key', async () => {
    const golf = files.find((f) => f.rel === 'golf-plus-2009-20tdi/sim-clear.json');
    expect(golf).toBeDefined();
    // `Required<…>`: a key added to ReplayFixtureExpect fails to compile here until this test gives
    // it a wrong value, so no expectation can be silently ignored by checkReplayFixture.
    const wrongExpect: Required<ReplayFixtureExpect> = {
      protocol: 'ISO_9141_2',
      vin: 'WRONGVIN000000000',
      supportedPidCount: 1,
      storedDtcs: ['P0001'],
      pendingDtcs: ['P0002'],
      milOn: false,
      freezeFrameCount: 9,
      storedDtcsAfterClear: ['P2183'],
    };
    const failures = await checkReplayFixture({
      ...(golf as { fixture: ReplayFixture }).fixture,
      expect: wrongExpect,
    });
    expect(failures.map((f) => f.split(':')[0])).toEqual([
      'protocol',
      'vin',
      'supportedPidCount',
      'milOn',
      'storedDtcs',
      'pendingDtcs',
      'freezeFrameCount',
      'storedDtcsAfterClear',
    ]);
    expect([...failures.map((f) => f.split(':')[0])].sort()).toEqual(
      Object.keys(wrongExpect).sort(),
    );
    expect(failures).toContainEqual(
      expect.stringMatching(/^pendingDtcs: expected \[P0002\], replayed \[/),
    );
    expect(failures).toContainEqual(
      expect.stringMatching(/^freezeFrameCount: expected 9, replayed \d+$/),
    );
  });

  it('a wrong freeze-frame count or pending list is reported too', async () => {
    const golf = files.find((f) => f.rel === 'golf-plus-2009-20tdi/sim-faults.json');
    expect(golf).toBeDefined();
    const fixture = (golf as { fixture: ReplayFixture }).fixture;
    expect(fixture.expect?.freezeFrameCount).toBe(3);
    const failures = await checkReplayFixture({
      ...fixture,
      expect: { pendingDtcs: ['P0002'], freezeFrameCount: 1 },
    });
    expect(failures).toEqual([
      expect.stringMatching(/^pendingDtcs: expected \[P0002\], replayed \[\]$/),
      expect.stringMatching(/^freezeFrameCount: expected 1, replayed 3$/),
    ]);
  });
});
