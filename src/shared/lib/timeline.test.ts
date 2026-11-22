import {
  groupByDay,
  localDayKey,
  mergeTimeline,
  summarizeTimeline,
  timelineId,
  type TimelineItem,
  type TimelineKind,
} from './timeline';

function item(
  kind: TimelineKind,
  sourceId: string,
  ts: number,
  extra: Partial<TimelineItem> = {},
): TimelineItem {
  return {
    id: timelineId(kind, sourceId),
    kind,
    ts,
    vehicleKey: 'id:golf',
    vehicleLabel: 'VW Golf Plus',
    title: `${kind} ${sourceId}`,
    tone: 'neutral',
    sourceId,
    ...extra,
  };
}

// Fixed local timestamps (built in the machine's time zone, so the midnight split is real).
const NOV9_0800 = new Date(2026, 10, 9, 8).getTime();
const NOV9_2330 = new Date(2026, 10, 9, 23, 30).getTime();
const NOV10_0010 = new Date(2026, 10, 10, 0, 10).getTime();
const NOV10_1200 = new Date(2026, 10, 10, 12).getTime();

describe('mergeTimeline', () => {
  it('flattens every source and sorts newest first', () => {
    const out = mergeTimeline([
      [item('ai', 'a', NOV9_0800), item('ai', 'b', NOV10_1200)],
      [item('trip', 't', NOV9_2330)],
      [item('scan', 's', NOV10_0010)],
    ]);
    expect(out.map((i) => i.id)).toEqual(['ai:b', 'scan:s', 'trip:t', 'ai:a']);
  });

  it('dedupes by id, keeping the first occurrence', () => {
    const out = mergeTimeline([
      [item('scan', 's', NOV9_0800, { title: 'first' })],
      [item('scan', 's', NOV10_1200, { title: 'second' }), item('scan', 'x', NOV9_2330)],
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((i) => i.id === 'scan:s')?.title).toBe('first');
  });

  it('filters by kinds (empty list = every kind)', () => {
    const lists = [
      [item('ai', 'a', NOV9_0800), item('dtc', 'd', NOV9_2330), item('trip', 't', NOV10_0010)],
    ];
    expect(mergeTimeline(lists, { kinds: ['dtc', 'trip'] }).map((i) => i.kind)).toEqual([
      'trip',
      'dtc',
    ]);
    expect(mergeTimeline(lists, { kinds: [] })).toHaveLength(3);
  });

  it('filters by vehicle key; "all" keeps every car', () => {
    const lists = [
      [
        item('ai', 'g', NOV9_0800, { vehicleKey: 'vin:WVW1' }),
        item('ai', 'p', NOV9_2330, { vehicleKey: 'id:punto' }),
      ],
    ];
    expect(mergeTimeline(lists, { vehicleKey: 'id:punto' }).map((i) => i.id)).toEqual(['ai:p']);
    expect(mergeTimeline(lists, { vehicleKey: 'all' })).toHaveLength(2);
  });

  it('filters by an inclusive time window', () => {
    const lists = [
      [item('ai', 'a', NOV9_0800), item('ai', 'b', NOV9_2330), item('ai', 'c', NOV10_1200)],
    ];
    expect(mergeTimeline(lists, { from: NOV9_2330, to: NOV10_0010 }).map((i) => i.id)).toEqual([
      'ai:b',
    ]);
  });

  it('query matches the title or the subtitle, case-insensitively', () => {
    const lists = [
      [
        item('scan', 'a', NOV9_0800, { title: 'Auto-scan · 2 faults', subtitle: '5/16 modules' }),
        item('trip', 'b', NOV9_2330, { title: 'Trip · 23.4 km', subtitle: '12 min · GPS' }),
        item('maintenance', 'c', NOV10_0010, { title: 'Service: Engine oil & filter' }),
      ],
    ];
    expect(mergeTimeline(lists, { query: 'AUTO-SCAN' }).map((i) => i.id)).toEqual(['scan:a']);
    expect(mergeTimeline(lists, { query: 'gps' }).map((i) => i.id)).toEqual(['trip:b']);
    expect(mergeTimeline(lists, { query: '  oil ' }).map((i) => i.id)).toEqual(['maintenance:c']);
    expect(mergeTimeline(lists, { query: '   ' })).toHaveLength(3);
    expect(mergeTimeline(lists, { query: 'nothing like this' })).toEqual([]);
  });
});

describe('groupByDay', () => {
  it('splits across local midnight, newest day first and newest item first', () => {
    const days = groupByDay(
      mergeTimeline([
        [
          item('ai', 'a', NOV9_0800),
          item('ai', 'b', NOV9_2330),
          item('ai', 'c', NOV10_0010),
          item('ai', 'd', NOV10_1200),
        ],
      ]),
    );
    expect(days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-09']);
    expect(days[0].items.map((i) => i.id)).toEqual(['ai:d', 'ai:c']);
    expect(days[1].items.map((i) => i.id)).toEqual(['ai:b', 'ai:a']);
  });

  it('orders days even when the input is not sorted', () => {
    const days = groupByDay([item('ai', 'a', NOV9_0800), item('ai', 'c', NOV10_1200)]);
    expect(days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-09']);
  });

  it('formats the day key with zero padding', () => {
    expect(localDayKey(new Date(2026, 0, 5, 10).getTime())).toBe('2026-01-05');
  });

  it('returns no days for no items', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('summarizeTimeline', () => {
  it('counts each kind, zero for absent kinds', () => {
    const counts = summarizeTimeline([
      item('ai', 'a', NOV9_0800),
      item('ai', 'b', NOV9_0800),
      item('scan', 's', NOV9_0800),
      item('report', 'r', NOV9_0800),
    ]);
    expect(counts).toEqual({
      ai: 2,
      dtc: 0,
      scan: 1,
      trip: 0,
      maintenance: 0,
      backup: 0,
      report: 1,
    });
  });
});
