import {
  itemId,
  orderItems,
  isHidden,
  visibleItems,
  moveInOrder,
  toggleInSet,
  presetFor,
  EMPTY_LAYOUT,
  type DashboardItem,
  type ProfileLayout,
} from './dashboardLayout';

const candidates: DashboardItem[] = [
  { id: 'gauge:010C', pid: '010C', kind: 'gauge' },
  { id: 'gauge:010D', pid: '010D', kind: 'gauge' },
  { id: 'card:0110', pid: '0110', kind: 'card' },
  { id: 'card:0142', pid: '0142', kind: 'card' },
];

describe('itemId', () => {
  it('builds a stable kind:pid id', () => {
    expect(itemId('gauge', '010C')).toBe('gauge:010C');
    expect(itemId('card', '0110')).toBe('card:0110');
  });
});

describe('orderItems', () => {
  it('reproduces the default order when there is no layout', () => {
    expect(orderItems(candidates, undefined)).toEqual(candidates);
    expect(orderItems(candidates, { order: [], hidden: [] })).toEqual(candidates);
  });

  it('honours the explicit order, then appends unknown/newer items in default order', () => {
    const layout: ProfileLayout = { order: ['card:0110', 'gauge:010C'], hidden: [] };
    expect(orderItems(candidates, layout).map((c) => c.id)).toEqual([
      'card:0110',
      'gauge:010C',
      'gauge:010D', // not in order → appended in candidate order
      'card:0142',
    ]);
  });

  it('ignores ids in order that are not currently candidates', () => {
    const layout: ProfileLayout = { order: ['card:9999', 'gauge:010D'], hidden: [] };
    expect(orderItems(candidates, layout).map((c) => c.id)).toEqual([
      'gauge:010D',
      'gauge:010C',
      'card:0110',
      'card:0142',
    ]);
  });
});

describe('isHidden / visibleItems', () => {
  it('filters hidden items but keeps the order', () => {
    const layout: ProfileLayout = { order: [], hidden: ['gauge:010D', 'card:0142'] };
    expect(isHidden('gauge:010D', layout)).toBe(true);
    expect(isHidden('gauge:010C', layout)).toBe(false);
    expect(visibleItems(candidates, layout).map((c) => c.id)).toEqual(['gauge:010C', 'card:0110']);
  });

  it('shows everything by default', () => {
    expect(visibleItems(candidates, undefined)).toEqual(candidates);
  });
});

describe('moveInOrder', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves an item up and down', () => {
    expect(moveInOrder(ids, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveInOrder(ids, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('is a no-op at the ends or for an absent id', () => {
    expect(moveInOrder(ids, 'a', -1)).toEqual(ids);
    expect(moveInOrder(ids, 'd', 1)).toEqual(ids);
    expect(moveInOrder(ids, 'z', -1)).toEqual(ids);
  });

  it('does not mutate the input', () => {
    const copy = ids.slice();
    moveInOrder(ids, 'b', 1);
    expect(ids).toEqual(copy);
  });
});

describe('toggleInSet', () => {
  it('adds when absent and removes when present', () => {
    expect(toggleInSet([], 'x')).toEqual(['x']);
    expect(toggleInSet(['x', 'y'], 'x')).toEqual(['y']);
  });
});

describe('presetFor (plan 07)', () => {
  /** What a car supporting every preset PID (plus one the presets never name) would show. */
  const supported: DashboardItem[] = [
    ...['010C', '010D', '0105'].map((pid) => ({
      id: itemId('gauge', pid),
      pid,
      kind: 'gauge' as const,
    })),
    ...['0104', '0106', '0107', '010B', '010E', '0110', '012F', '0142', '015C', '015E'].map(
      (pid) => ({ id: itemId('card', pid), pid, kind: 'card' as const }),
    ),
  ];
  const cardOrder = (layout: ProfileLayout) =>
    visibleItems(supported, layout)
      .filter((i) => i.kind === 'card')
      .map((i) => i.pid);

  it('diesel: the three gauges, then boost, oil temp, MAF, fuel rate, voltage — 010B before 0106', () => {
    const layout = presetFor('diesel');
    expect(layout.order.slice(0, 3)).toEqual(['gauge:010C', 'gauge:010D', 'gauge:0105']);
    expect(layout.hidden).toEqual([]);
    const cards = cardOrder(layout);
    expect(cards.slice(0, 5)).toEqual(['010B', '015C', '0110', '015E', '0142']);
    expect(cards.indexOf('010B')).toBeLessThan(cards.indexOf('0106'));
  });

  it('petrol leads with the fuel trims, timing, MAP / MAF, voltage and fuel level', () => {
    const cards = cardOrder(presetFor('petrol'));
    expect(presetFor('petrol').order).toContain('card:0106');
    expect(cards.slice(0, 7)).toEqual(['0106', '0107', '010E', '010B', '0110', '0142', '012F']);
    expect(cards.indexOf('0106')).toBeLessThan(cards.indexOf('010B'));
    expect(presetFor('lpg')).toEqual(presetFor('petrol'));
  });

  it('hybrid is the petrol set with the voltage first', () => {
    expect(cardOrder(presetFor('hybrid')).slice(0, 3)).toEqual(['0142', '0106', '0107']);
    expect(presetFor('hybrid').order.filter((id) => id === 'card:0142')).toHaveLength(1);
  });

  it('an unknown fuel keeps the default order (EMPTY_LAYOUT)', () => {
    expect(presetFor('other')).toBe(EMPTY_LAYOUT);
    expect(presetFor(undefined)).toBe(EMPTY_LAYOUT);
    expect(visibleItems(supported, presetFor('other'))).toEqual(supported);
  });

  it('keeps every supported item visible: unnamed PIDs follow, missing ones are skipped', () => {
    const fewer = supported.filter((i) => i.pid !== '015C');
    const shown = visibleItems(fewer, presetFor('diesel'));
    expect(shown).toHaveLength(fewer.length);
    expect(shown.map((i) => i.pid)).toContain('0104');
  });
});
