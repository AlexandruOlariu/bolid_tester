import * as fs from 'fs';
import * as path from 'path';
import { MORE_SECTIONS, entryKey, entryMatches, filterSections, type MoreEntry } from './sections';

/** Every hidden (`href: null`) route in src/app/_layout.tsx. Kept by hand so a change to the
 *  layout is a deliberate change here too; the last test checks it against the file. */
const HIDDEN_ROUTES = [
  '/extended',
  '/ai-diagnose',
  '/history',
  '/report',
  '/charts',
  '/performance',
  '/trips',
  '/trip-detail',
  '/alerts',
  '/sensors',
  '/coding',
  '/notifications',
  '/service-reset',
  '/dpf',
  '/inspection',
  '/battery',
  '/vin-decode',
  '/maintenance',
  '/error-log',
  '/feedback',
  '/licenses',
  '/backup',
  '/module-scan',
  '/adaptations',
  '/routines',
  '/sniffer',
  '/adapter-health',
  '/settings-ai',
  '/settings-privacy',
  '/settings-label-packs',
  '/settings-plugins',
  '/settings-developer',
  '/settings-about',
];

/** Hidden routes reached from somewhere else than More: Info opens Extended PIDs, a trip row on
 *  Trips opens its detail screen, Settings → About opens Licences (plan 30), and the Settings hub
 *  opens its pages (plan 07). */
const REACHED_ELSEWHERE = [
  '/extended',
  '/trip-detail',
  '/licenses',
  '/settings-ai',
  '/settings-privacy',
  '/settings-label-packs',
  '/settings-plugins',
  '/settings-developer',
  '/settings-about',
];

const allEntries = (): MoreEntry[] => MORE_SECTIONS.flatMap((s) => s.entries);
const titles = (sections: typeof MORE_SECTIONS) =>
  sections.map((s) => ({ id: s.id, entries: s.entries.map((e) => e.title) }));

describe('MORE_SECTIONS', () => {
  it('has the five sections in order', () => {
    expect(MORE_SECTIONS.map((s) => s.id)).toEqual([
      'diagnose',
      'drive',
      'ownership',
      'workshop',
      'tools',
    ]);
  });

  it('puts every hidden route in exactly one section, except those reached elsewhere', () => {
    const routes = allEntries()
      .map((e) => e.route)
      .filter((r): r is string => r !== null);
    for (const route of HIDDEN_ROUTES) {
      const count = routes.filter((r) => r === route).length;
      expect({ route, count }).toEqual({ route, count: REACHED_ELSEWHERE.includes(route) ? 0 : 1 });
    }
    // …and nothing in More points at a route the layout does not register.
    for (const route of routes) expect(HIDDEN_ROUTES).toContain(route);
  });

  it('flags exactly the Workshop rows as experimental, and gives Workshop its blurb', () => {
    for (const s of MORE_SECTIONS) {
      for (const e of s.entries)
        expect({ e: e.title, x: !!e.experimental }).toEqual({ e: e.title, x: s.id === 'workshop' });
    }
    expect(MORE_SECTIONS.find((s) => s.id === 'workshop')?.blurb).toMatch(/CAN cars only/);
  });

  it('keeps the Check for updates action row in Tools, and unique row keys', () => {
    const tools = MORE_SECTIONS.find((s) => s.id === 'tools')!;
    expect(tools.entries.find((e) => e.action === 'check-updates')?.title).toBe(
      'Check for updates',
    );
    const keys = allEntries().map(entryKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches the hidden routes registered in _layout.tsx', () => {
    const layout = fs.readFileSync(path.resolve(__dirname, '../../../app/_layout.tsx'), 'utf8');
    const hidden = [...layout.matchAll(/name="([a-z0-9-]+)"\s+options=\{\{\s*href: null/g)].map(
      (m) => `/${m[1]}`,
    );
    expect(hidden.sort()).toEqual([...HIDDEN_ROUTES].sort());
  });
});

describe('filterSections', () => {
  it('returns every section for an empty or blank query', () => {
    expect(filterSections(MORE_SECTIONS, '')).toBe(MORE_SECTIONS);
    expect(filterSections(MORE_SECTIONS, '   ')).toBe(MORE_SECTIONS);
  });

  it('"dpf" leaves only Ownership with the DPF entry', () => {
    expect(titles(filterSections(MORE_SECTIONS, 'dpf'))).toEqual([
      { id: 'ownership', entries: ['DPF / regen'] },
    ]);
  });

  it('"cod" leaves only Coding in Workshop (word starts, so "Decode" does not match)', () => {
    expect(titles(filterSections(MORE_SECTIONS, 'cod'))).toEqual([
      { id: 'workshop', entries: ['Coding'] },
    ]);
  });

  it('is case-insensitive, searches keywords and needs every query word', () => {
    expect(titles(filterSections(MORE_SECTIONS, 'VCDS'))).toEqual([
      { id: 'workshop', entries: ['Module scan'] },
    ]);
    expect(titles(filterSections(MORE_SECTIONS, 'service interval'))).toEqual([
      { id: 'workshop', entries: ['Service reset'] },
    ]);
    expect(filterSections(MORE_SECTIONS, 'zzz')).toEqual([]);
  });

  it('finds the Check for updates row', () => {
    expect(titles(filterSections(MORE_SECTIONS, 'updates'))).toEqual([
      { id: 'tools', entries: ['Check for updates'] },
    ]);
  });
});

describe('entryMatches', () => {
  const entry: MoreEntry = {
    route: '/x',
    title: 'Battery & charging',
    subtitle: 'Voltage, cranking',
    icon: 'battery-charging',
    keywords: ['alternator'],
  };

  it('matches word starts in the title, subtitle and keywords', () => {
    expect(entryMatches(entry, 'batt')).toBe(true);
    expect(entryMatches(entry, 'crank')).toBe(true);
    expect(entryMatches(entry, 'altern')).toBe(true);
    expect(entryMatches(entry, 'arging')).toBe(false);
    expect(entryMatches(entry, '')).toBe(true);
  });
});
