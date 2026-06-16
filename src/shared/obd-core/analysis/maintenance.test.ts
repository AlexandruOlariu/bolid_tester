import {
  DEFAULT_SERVICE_ITEMS,
  ServiceItem,
  LogEntry,
  dueStatus,
  computeDue,
  lastEntryFor,
  projectOdometer,
} from './maintenance';

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;
const NOW = 1_700_000_000_000;

const oil: ServiceItem = { id: 'engine-oil', name: 'Engine oil & filter', intervalKm: 15000, intervalMonths: 12 };

function entry(odoKm: number, monthsAgo: number): LogEntry {
  return { id: `e${odoKm}`, itemId: 'engine-oil', date: NOW - monthsAgo * MONTH, odoKm };
}

describe('maintenance due math', () => {
  it('is ok well within both intervals', () => {
    const d = dueStatus(oil, entry(100000, 2), { odoKm: 105000, now: NOW });
    expect(d.status).toBe('ok');
    expect(d.dueInKm).toBe(10000);
  });

  it('is soon when close on distance', () => {
    const d = dueStatus(oil, entry(100000, 1), { odoKm: 114000, now: NOW });
    expect(d.dueInKm).toBe(1000);
    expect(d.status).toBe('soon');
  });

  it('is overdue when the time interval has passed', () => {
    const d = dueStatus(oil, entry(100000, 13), { odoKm: 108000, now: NOW });
    expect(d.dueInDays).toBeLessThan(0);
    expect(d.status).toBe('overdue');
  });

  it('is unknown with no history', () => {
    const d = dueStatus(oil, null, { odoKm: 120000, now: NOW });
    expect(d.status).toBe('unknown');
  });

  it('picks the most recent entry per item', () => {
    const entries = [entry(100000, 12), entry(130000, 1), entry(115000, 6)];
    expect(lastEntryFor(entries, 'engine-oil')?.odoKm).toBe(130000);
  });

  it('computes due for the whole default catalogue', () => {
    const due = computeDue(DEFAULT_SERVICE_ITEMS, [], { odoKm: 200000, now: NOW });
    expect(due).toHaveLength(DEFAULT_SERVICE_ITEMS.length);
    expect(due.every((d) => d.status === 'unknown')).toBe(true);
  });

  it('projects an odometer from average yearly distance', () => {
    expect(projectOdometer(100000, NOW - 365 * DAY, 15000, NOW)).toBe(115000);
  });
});
