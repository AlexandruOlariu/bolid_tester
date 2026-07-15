import {
  itemId,
  orderItems,
  isHidden,
  visibleItems,
  moveInOrder,
  toggleInSet,
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
