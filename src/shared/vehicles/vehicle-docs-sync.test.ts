import * as fs from 'fs';
import * as path from 'path';
import { VEHICLE_PROFILES } from '.';

// docs are authoritative; this guards that code profiles stay in sync with their Markdown.
const DOCS_DIR = path.resolve(__dirname, '../../../docs/vehicles');

function readFrontMatter(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return fm;
}

describe('vehicle docs ↔ code sync', () => {
  for (const p of VEHICLE_PROFILES.filter((v) => v.id !== 'generic')) {
    it(`${p.id} has a matching doc with consistent front-matter`, () => {
      const file = path.join(DOCS_DIR, `${p.id}.md`);
      expect(fs.existsSync(file)).toBe(true);

      const fm = readFrontMatter(file);
      expect(fm.id).toBe(p.id);
      expect(fm.expectedProtocol).toBe(p.expectedProtocol);
      expect(Number(fm.supportedPidCount)).toBe(p.supportedPids.length);
      expect(fm.extended === 'true').toBe(Boolean(p.extendedPids && p.extendedPids.length > 0));
    });
  }

  it('every vehicle doc has a registered profile', () => {
    const ids = new Set(VEHICLE_PROFILES.map((p) => p.id));
    const docs = fs
      .readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith('.md') && f !== 'README.md');
    for (const f of docs) {
      expect(ids.has(f.replace(/\.md$/, ''))).toBe(true);
    }
  });
});
