/** `scripts/build-adapter-matrix.mjs` end to end (plan 29): spawned against temp report / output
 *  dirs through its `--reports` / `--out` overrides, the way CI runs `--check` on the repository. */
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { AdapterReportJson } from './adapterMatrix';
import { sampleReport } from './testing/sampleReport';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'build-adapter-matrix.mjs');

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('build-adapter-matrix script', () => {
  let tmp: string;
  let reports: string;
  let out: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'adapter-matrix-'));
    reports = join(tmp, 'reports');
    out = join(tmp, 'out');
    mkdirSync(reports);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const addReport = (name: string, r: AdapterReportJson | string) =>
    writeFileSync(join(reports, name), typeof r === 'string' ? r : JSON.stringify(r, null, 2));
  const read = (name: string) => readFileSync(join(out, name), 'utf8');

  it('writes the header and "No reports yet" with zero reports', () => {
    const r = run('--reports', reports, '--out', out);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const matrix = read('matrix.md');
    expect(matrix).toContain('| Adapter | Firmware | Link | Reports | Typical grade |');
    expect(matrix).toContain('No reports yet');
    expect(read('knownAdapters.json')).toBe('[]\n');
    expect(run('--check', '--reports', reports, '--out', out).code).toBe(0);
  });

  it('aggregates two reports for one adapter and one for another', () => {
    addReport('ios-vlink__elm327-v2-2__2026-11-01.json', sampleReport({ median: 20 }));
    addReport(
      'ios-vlink__elm327-v2-2__2026-11-02.json',
      sampleReport({ median: 36, ranAt: '2026-11-02T10:00:00.000Z' }),
    );
    addReport(
      'obdii__elm327-v1-5__2026-11-03.json',
      sampleReport({ deviceName: 'OBDII', firmware: 'ELM327 v1.5', median: 140, grade: 'poor' }),
    );
    const r = run('--reports', reports, '--out', out);
    expect(r.code).toBe(0);
    expect(r.out).toContain('3 report(s), 2 adapter(s)');

    const rows = read('matrix.md')
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Adapter') && !l.startsWith('| ---'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^\| IOS-Vlink \| ELM327 v2\.2 \| ble \| 2 \| GOOD \| 28 \|/);
    expect(rows[0]).toContain('[guide](../adapter-vgate-icar-pro.md)');
    expect(rows[1]).toMatch(/^\| OBDII \| ELM327 v1\.5 \| ble \| 1 \| POOR \| 140 \|/);
    expect(existsSync(join(out, 'ios-vlink__elm327-v2-2.md'))).toBe(true);
    expect(existsSync(join(out, 'obdii__elm327-v1-5.md'))).toBe(true);
    const known = JSON.parse(read('knownAdapters.json'));
    expect(known).toHaveLength(2);
    expect(known[0]).toMatchObject({ slug: 'ios-vlink__elm327-v2-2', reports: 2, medianMs: 28 });
  });

  it('refuses a simulator report with exit 1', () => {
    addReport('sim.json', sampleReport({ link: 'mock' }));
    const r = run('--reports', reports, '--out', out);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/sim\.json: simulator reports/);
    expect(existsSync(join(out, 'matrix.md'))).toBe(false);
  });

  it('refuses malformed files with exit 1', () => {
    addReport('broken.json', '{ "schema": 1, ');
    addReport('old.json', { ...sampleReport(), schema: 0 } as unknown as AdapterReportJson);
    const r = run('--reports', reports, '--out', out);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/broken\.json: not valid JSON/);
    expect(r.err).toMatch(/old\.json: "schema" must be 1/);
  });

  it('--check fails on a hand-edited or stale output and passes once rebuilt', () => {
    addReport('a.json', sampleReport());
    expect(run('--reports', reports, '--out', out).code).toBe(0);
    expect(run('--check', '--reports', reports, '--out', out).code).toBe(0);

    writeFileSync(join(out, 'matrix.md'), read('matrix.md') + '\nhand edit\n');
    const edited = run('--check', '--reports', reports, '--out', out);
    expect(edited.code).toBe(1);
    expect(edited.err).toMatch(/out of date: .*matrix\.md/);

    // A new report makes every output stale until the next build.
    expect(run('--reports', reports, '--out', out).code).toBe(0);
    addReport('b.json', sampleReport({ deviceName: 'OBDII' }));
    const stale = run('--check', '--reports', reports, '--out', out);
    expect(stale.code).toBe(1);
    expect(stale.err).toMatch(/missing: .*obdii__elm327-v2-2\.md/);
  });

  it('removes the page of an adapter whose reports are gone', () => {
    addReport('a.json', sampleReport());
    run('--reports', reports, '--out', out);
    expect(existsSync(join(out, 'ios-vlink__elm327-v2-2.md'))).toBe(true);
    rmSync(join(reports, 'a.json'));
    expect(run('--check', '--reports', reports, '--out', out).err).toMatch(/stale generated page/);
    expect(run('--reports', reports, '--out', out).code).toBe(0);
    expect(existsSync(join(out, 'ios-vlink__elm327-v2-2.md'))).toBe(false);
  });

  it('the committed matrix and knownAdapters.json are up to date', () => {
    const r = run('--check');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
  });
});
