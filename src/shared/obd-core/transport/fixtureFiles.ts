/** Node-only helper for the tests that read the committed replay fixtures
 *  (`transport/fixtures/<vehicleId>/<flow>.json`). The app never imports it — fixtures reach the
 *  app only as exported files. New files need no registration: everything under the directory is
 *  picked up. */
import * as fs from 'fs';
import * as path from 'path';
import { ReplayFixture } from './logReplay';

export const FIXTURES_DIR = path.join(__dirname, 'fixtures');

export interface FixtureFile {
  /** `<vehicleId>/<file>.json`, always with a forward slash. */
  rel: string;
  vehicleDir: string;
  file: string;
  fixture: ReplayFixture;
}

export function readFixtureFiles(dir: string = FIXTURES_DIR): FixtureFile[] {
  if (!fs.existsSync(dir)) return [];
  const out: FixtureFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(dir, entry.name)).sort()) {
      if (!file.endsWith('.json')) continue;
      const text = fs.readFileSync(path.join(dir, entry.name, file), 'utf8');
      out.push({
        rel: `${entry.name}/${file}`,
        vehicleDir: entry.name,
        file,
        fixture: JSON.parse(text) as ReplayFixture,
      });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}
