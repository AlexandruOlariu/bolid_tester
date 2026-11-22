/** The More hub's information architecture (plan 07): every screen that is not a tab, grouped into
 *  five sections, with the write-capable Workshop tools flagged as experimental. Pure data plus a
 *  search filter, free of React and of icon components (the UI maps `IconName` to a lucide icon),
 *  so it is unit-tested in node. See docs/features/more.md. */

/** The icon a row shows; `ui/MoreScreen.tsx` maps each name to a lucide component. */
export type IconName =
  | 'stethoscope'
  | 'clipboard-check'
  | 'history'
  | 'file-stack'
  | 'gauge'
  | 'line-chart'
  | 'timer'
  | 'route'
  | 'bell'
  | 'calendar-clock'
  | 'battery-charging'
  | 'wind'
  | 'scan-line'
  | 'bell-ring'
  | 'network'
  | 'sliders'
  | 'zap'
  | 'key-round'
  | 'wrench'
  | 'radio'
  | 'heart-pulse'
  | 'archive'
  | 'bug'
  | 'message-square-warning'
  | 'download-cloud';

export interface MoreEntry {
  /** The expo-router path the row opens, or null for an in-place action row. */
  route: string | null;
  /** An in-place action instead of a route (the **Check for updates** row). */
  action?: 'check-updates';
  title: string;
  subtitle: string;
  icon: IconName;
  /** Talks to control modules beyond the engine (and may write to them): shown with a badge. */
  experimental?: boolean;
  /** Extra search words; the title and subtitle are always searched. */
  keywords?: string[];
}

export type MoreSectionId = 'diagnose' | 'drive' | 'ownership' | 'workshop' | 'tools';

export interface MoreSection {
  id: MoreSectionId;
  title: string;
  blurb?: string;
  entries: MoreEntry[];
}

/** Stable key for a row: its route, or its action for an action row. */
export function entryKey(entry: MoreEntry): string {
  return entry.route ?? `action:${entry.action ?? entry.title}`;
}

export const MORE_SECTIONS: MoreSection[] = [
  {
    id: 'diagnose',
    title: 'Diagnose',
    entries: [
      {
        route: '/ai-diagnose',
        title: 'Diagnose (AI)',
        subtitle: 'One-tap AI health check',
        icon: 'stethoscope',
        keywords: ['assistant', 'explain', 'faults'],
      },
      {
        route: '/inspection',
        title: 'Used-car inspection',
        subtitle: 'Pre-purchase health check',
        icon: 'clipboard-check',
        keywords: ['buy', 'purchase', 'second hand'],
      },
      {
        route: '/history',
        title: 'History',
        subtitle: 'Timeline of diagnoses, scans, trips, service and reports',
        icon: 'history',
        keywords: ['past', 'saved', 'timeline'],
      },
      {
        route: '/report',
        title: 'Vehicle report',
        subtitle: 'The whole car in one PDF to share',
        icon: 'file-stack',
        keywords: ['mechanic', 'export', 'html', 'markdown'],
      },
      {
        route: '/sensors',
        title: 'Sensor tests',
        subtitle: 'Mode 06 monitors + module sensors',
        icon: 'gauge',
        keywords: ['oxygen', 'lambda', 'catalyst', 'misfire'],
      },
    ],
  },
  {
    id: 'drive',
    title: 'Drive',
    entries: [
      {
        route: '/charts',
        title: 'Charts',
        subtitle: 'Live parameters over time',
        icon: 'line-chart',
        keywords: ['graph', 'plot'],
      },
      {
        route: '/performance',
        title: 'Performance',
        subtitle: '0–100, ¼-mile, braking',
        icon: 'timer',
        keywords: ['acceleration', 'quarter mile', 'sprint'],
      },
      {
        route: '/trips',
        title: 'Trips',
        subtitle: 'Record & export live data',
        icon: 'route',
        keywords: ['gps', 'map', 'csv', 'journey'],
      },
      {
        route: '/alerts',
        title: 'Alerts',
        subtitle: 'Threshold warnings',
        icon: 'bell',
        keywords: ['limit', 'overheat'],
      },
    ],
  },
  {
    id: 'ownership',
    title: 'Ownership',
    entries: [
      {
        route: '/maintenance',
        title: 'Maintenance log',
        subtitle: 'Service history & due items',
        icon: 'calendar-clock',
        keywords: ['oil', 'logbook', 'reminder'],
      },
      {
        route: '/battery',
        title: 'Battery & charging',
        subtitle: 'Voltage, cranking, alternator',
        icon: 'battery-charging',
        keywords: ['12 v', 'start'],
      },
      {
        route: '/dpf',
        title: 'DPF / regen',
        subtitle: 'Diesel soot & regeneration',
        icon: 'wind',
        keywords: ['particulate filter', 'exhaust'],
      },
      {
        route: '/vin-decode',
        title: 'VIN decoder',
        subtitle: 'Decode the VIN offline',
        icon: 'scan-line',
        keywords: ['vehicle identification number', 'chassis'],
      },
      {
        route: '/notifications',
        title: 'Notifications',
        subtitle: 'Alerts & reminders',
        icon: 'bell-ring',
        keywords: ['push', 'mute'],
      },
    ],
  },
  {
    id: 'workshop',
    title: 'Workshop',
    blurb:
      'Talks to control modules beyond the engine. CAN cars only; addresses are confirmed per car.',
    entries: [
      {
        route: '/module-scan',
        title: 'Module scan',
        subtitle: 'VCDS-style auto-scan: all modules',
        icon: 'network',
        experimental: true,
        keywords: ['vcds', 'control modules', 'all faults'],
      },
      {
        route: '/adaptations',
        title: 'Adaptations',
        subtitle: 'Channel read/write with backup',
        icon: 'sliders',
        experimental: true,
        keywords: ['channels', 'login', 'kwp'],
      },
      {
        route: '/routines',
        title: 'Routines & output tests',
        subtitle: 'Basic settings, actuator tests, forced regeneration',
        icon: 'zap',
        experimental: true,
        keywords: ['output tests', 'throttle body'],
      },
      {
        route: '/coding',
        title: 'Coding',
        subtitle: 'Experimental module coding',
        icon: 'key-round',
        experimental: true,
        keywords: ['long coding', 'bits', 'retrofit'],
      },
      {
        route: '/service-reset',
        title: 'Service reset',
        subtitle: 'Reset the service interval',
        icon: 'wrench',
        experimental: true,
        keywords: ['oil service', 'interval'],
      },
      {
        route: '/sniffer',
        title: 'Bus sniffer',
        subtitle: 'Raw CAN/K-line monitor (ATMA); save and share captures',
        icon: 'radio',
        experimental: true,
        keywords: ['capture', 'frames', 'monitor'],
      },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    entries: [
      {
        route: '/adapter-health',
        title: 'Adapter health',
        subtitle: 'Grade your ELM327: firmware, latency',
        icon: 'heart-pulse',
        keywords: ['obd adapter', 'bluetooth', 'clone'],
      },
      {
        route: '/backup',
        title: 'Backup & restore',
        subtitle: 'All your data in one file; restore it on any phone',
        icon: 'archive',
        keywords: ['export', 'import', 'new phone'],
      },
      {
        route: '/error-log',
        title: 'Error log',
        subtitle: 'Saved errors to export & fix later',
        icon: 'bug',
        keywords: ['crash', 'bugs'],
      },
      {
        route: '/feedback',
        title: 'Report a problem',
        subtitle: 'Send the maintainer a redacted log bundle',
        icon: 'message-square-warning',
        keywords: ['feedback', 'bug report', 'support', 'issue', 'logs'],
      },
      {
        route: null,
        action: 'check-updates',
        title: 'Check for updates',
        subtitle: 'Over-the-air app updates',
        icon: 'download-cloud',
        keywords: ['version', 'upgrade', 'ota'],
      },
    ],
  },
];

/** `(key, english) → text in the UI language`; the More screen passes i18next's `t`. */
export type SectionTranslator = (key: string, english: string) => string;

/** The sections with titles, subtitles and blurbs in the UI language (plan 11): keys
 *  `more:section.<id>.title|blurb` and `more:entry.<route or action>.title|subtitle`. The English
 *  title and subtitle join the search keywords, so an English word still finds a row in Romanian. */
export function localizeSections(sections: MoreSection[], tr: SectionTranslator): MoreSection[] {
  return sections.map((s) => ({
    ...s,
    title: tr(`section.${s.id}.title`, s.title),
    blurb: s.blurb ? tr(`section.${s.id}.blurb`, s.blurb) : undefined,
    entries: s.entries.map((e) => {
      const id = (e.route ?? e.action ?? e.title).replace(/^\//, '');
      return {
        ...e,
        title: tr(`entry.${id}.title`, e.title),
        subtitle: tr(`entry.${id}.subtitle`, e.subtitle),
        keywords: [...(e.keywords ?? []), e.title, e.subtitle],
      };
    }),
  }));
}

/** Lower-case words of a text (split on anything that is not a letter or a digit). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** True when every word of the query starts a word of the entry's title, subtitle or keywords
 *  (case-insensitive). Word starts, not substrings: `cod` finds Coding but not "Decode the VIN". */
export function entryMatches(entry: MoreEntry, query: string): boolean {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const haystack = words([entry.title, entry.subtitle, ...(entry.keywords ?? [])].join(' '));
  return wanted.every((w) => haystack.some((h) => h.startsWith(w)));
}

/** The sections with only the entries that match `query`; a section left empty is dropped. An
 *  empty (or blank) query returns every section unchanged. */
export function filterSections(sections: MoreSection[], query: string): MoreSection[] {
  if (words(query).length === 0) return sections;
  return sections
    .map((s) => ({ ...s, entries: s.entries.filter((e) => entryMatches(e, query)) }))
    .filter((s) => s.entries.length > 0);
}
