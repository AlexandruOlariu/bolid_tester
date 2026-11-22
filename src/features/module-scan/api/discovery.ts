/** Module address discovery → the car's module list (plan 25). Pure helpers: turn a discovered
 *  candidate into a `DiagModule`, render it as the TypeScript literal a developer pastes into a
 *  registry profile, and tell whether the car already lists that address pair. The probing itself
 *  is `discoverUdsModules` in obd-core. See docs/features/module-scan.md → Discover modules. */
import type { DiscoveredModule } from '@/shared/obd-core';
import type { DiagModule } from '@/shared/vehicles';

const up = (s: string | undefined) => (s ?? '').toUpperCase();

/** The module entry for a discovered candidate: UDS, its id pair, still `experimental` (a module
 *  that answered is evidence of the address, not of everything else about it). */
export function discoveredToModule(d: DiscoveredModule): DiagModule {
  return {
    address: d.candidate.address,
    name: d.candidate.name,
    transport: 'uds',
    reqHeader: d.candidate.reqHeader,
    rxFilter: d.candidate.rxFilter,
    experimental: true,
  };
}

/** True when the car's module list already has a UDS module on this exact id pair. */
export function isInModuleList(d: DiscoveredModule, modules: DiagModule[]): boolean {
  return modules.some(
    (m) =>
      m.transport === 'uds' &&
      up(m.reqHeader) === up(d.candidate.reqHeader) &&
      up(m.rxFilter) === up(d.candidate.rxFilter),
  );
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The `DiagModule` literal for a registry profile's `modules: [...]` (developer flow): the id
 *  pair, `experimental: true`, the read ident as the simulator's `sampleIdent`, and a reminder to
 *  add `confirmed` once the adapter log is committed as a fixture. */
export function diagModuleLiteral(d: DiscoveredModule): string {
  const m = discoveredToModule(d);
  const lines = [
    '{',
    `  address: ${quote(m.address)},`,
    `  name: ${quote(m.name)},`,
    `  transport: 'uds',`,
    `  reqHeader: ${quote(m.reqHeader ?? '')},`,
    `  rxFilter: ${quote(m.rxFilter ?? '')},`,
    '  experimental: true,',
  ];
  const raw = d.ident?.raw ?? {};
  const dids = Object.keys(raw);
  if (dids.length) {
    lines.push(`  sampleIdent: { ${dids.map((k) => `${k}: ${quote(raw[k])}`).join(', ')} },`);
  }
  lines.push(
    '  // Found by Discover modules. Export the adapter log as a fixture (plan 02), then add:',
    "  // confirmed: { on: 'YYYY-MM-DD', source: 'on-car', fixture: 'src/shared/obd-core/transport/fixtures/<car>/discover.json' },",
    '},',
  );
  return lines.join('\n');
}
