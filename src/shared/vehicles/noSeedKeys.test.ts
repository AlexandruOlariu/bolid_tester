/** Plan 23 policy, enforced: the app ships no seed→key routine. No registry profile supplies a
 *  `seedToKey` (the field stays on the types for tests and fakes only), no vehicle source file
 *  mentions one, and no production file under src/ falls back to an identity key. */
import * as fs from 'fs';
import * as path from 'path';
import { VEHICLE_PROFILES } from './index';

const SRC = path.resolve(__dirname, '../..');

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) productionFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no shipped seed/key routines', () => {
  it('no registry profile sets seedToKey', () => {
    for (const p of VEHICLE_PROFILES) {
      expect(p.serviceReset?.security?.seedToKey).toBeUndefined();
      for (const r of p.routines ?? []) expect(r.security?.seedToKey).toBeUndefined();
    }
  });

  it('no vehicle source file mentions seedToKey outside the type declarations', () => {
    const hits = productionFiles(__dirname).filter(
      (f) => path.basename(f) !== 'types.ts' && fs.readFileSync(f, 'utf8').includes('seedToKey'),
    );
    expect(hits).toEqual([]);
  });

  it('no production file falls back to an identity seed→key', () => {
    const identity = /seedToKey[^\n]{0,40}\(\s*(\w+)\s*\)\s*=>\s*\1\b(?!\s*[.[(])/;
    const hits = productionFiles(SRC).filter((f) => identity.test(fs.readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
