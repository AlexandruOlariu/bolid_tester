/** Record the simulator into committed replay fixtures: for every registry profile, the `connect`,
 *  `faults` and `clear` flows are recorded against `MockTransport(buildScenario(id))` and written to
 *  `src/shared/obd-core/transport/fixtures/<id>/sim-<flow>.json` (stale `sim-*.json` files are
 *  removed; car fixtures are never touched). Run `npm run fixtures:sim` after changing a profile or
 *  the simulator; `sim-fixtures.freshness.test.ts` fails until you do. See docs/simulator.md →
 *  "Replay fixtures". */
import * as fs from 'fs';
import * as path from 'path';
import {
  recordAllSimFixtures,
  serializeFixture,
} from '../src/shared/obd-core/transport/simFixtures';

const FIXTURES_DIR = path.resolve(__dirname, '../src/shared/obd-core/transport/fixtures');

async function main(): Promise<void> {
  const fixtures = await recordAllSimFixtures();
  const wanted = new Set(Object.keys(fixtures));

  let written = 0;
  let unchanged = 0;
  for (const [rel, fixture] of Object.entries(fixtures)) {
    const file = path.join(FIXTURES_DIR, rel);
    const text = serializeFixture(fixture);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      : null;
    if (current === text) {
      unchanged += 1;
      continue;
    }
    fs.writeFileSync(file, text, 'utf8');
    written += 1;
    process.stdout.write(`wrote ${path.relative(process.cwd(), file)}\n`);
  }

  let removed = 0;
  if (fs.existsSync(FIXTURES_DIR)) {
    for (const dir of fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(FIXTURES_DIR, dir.name))) {
        const rel = `${dir.name}/${f}`;
        if (f.startsWith('sim-') && f.endsWith('.json') && !wanted.has(rel)) {
          fs.unlinkSync(path.join(FIXTURES_DIR, dir.name, f));
          removed += 1;
          process.stdout.write(`removed stale ${rel}\n`);
        }
      }
    }
  }

  process.stdout.write(
    `simulator fixtures: ${written} written, ${unchanged} unchanged, ${removed} removed\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`record-sim-fixtures failed: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
