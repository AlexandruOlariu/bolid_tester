import {
  NotifPrefs,
  NotifEvent,
  deriveDiagnosticEvents,
  isQuietHours,
  filterNotifications,
  dueReminders,
} from './notifications';

const allOn: NotifPrefs = {
  categories: { alert: true, connection: true, diagnostic: true, trip: true, maintenance: true },
};

describe('deriveDiagnosticEvents', () => {
  it('establishes a baseline with no events on first observation', () => {
    expect(deriveDiagnosticEvents(null, { status: 'connected', milOn: true, dtcCount: 2 })).toHaveLength(0);
  });

  it('emits one event on the MIL rising edge, not per poll', () => {
    const prev = { status: 'connected' as const, milOn: false, dtcCount: 0 };
    const e1 = deriveDiagnosticEvents(prev, { status: 'connected', milOn: true, dtcCount: 1 });
    expect(e1.some((e) => e.category === 'diagnostic' && e.title.includes('Check-engine'))).toBe(true);
    // Still on next tick → no new MIL event.
    const e2 = deriveDiagnosticEvents(
      { status: 'connected', milOn: true, dtcCount: 1 },
      { status: 'connected', milOn: true, dtcCount: 1 },
    );
    expect(e2).toHaveLength(0);
  });

  it('emits connect/disconnect transitions', () => {
    expect(
      deriveDiagnosticEvents({ status: 'connecting', milOn: false, dtcCount: 0 }, { status: 'connected', milOn: false, dtcCount: 0 })[0].category,
    ).toBe('connection');
  });
});

describe('quiet hours + filtering', () => {
  it('detects wrap-past-midnight quiet hours', () => {
    const prefs: NotifPrefs = { ...allOn, quietHours: { startMin: 22 * 60, endMin: 7 * 60 } };
    expect(isQuietHours(prefs, new Date(2026, 0, 1, 23, 0))).toBe(true);
    expect(isQuietHours(prefs, new Date(2026, 0, 1, 12, 0))).toBe(false);
  });

  it('suppresses non-critical during quiet hours but lets critical through', () => {
    const prefs: NotifPrefs = { ...allOn, quietHours: { startMin: 0, endMin: 24 * 60 } };
    const events: NotifEvent[] = [
      { id: 'a', category: 'alert', severity: 'warn', title: 'warn', ts: 1 },
      { id: 'b', category: 'alert', severity: 'critical', title: 'crit', ts: 1 },
    ];
    const out = filterNotifications(events, prefs, new Date(2026, 0, 1, 3, 0));
    expect(out.map((e) => e.id)).toEqual(['b']);
  });

  it('respects category toggles, mute, and dedupe', () => {
    const events: NotifEvent[] = [
      { id: 'x', category: 'connection', severity: 'info', title: 'c', ts: 1 },
      { id: 'x', category: 'connection', severity: 'info', title: 'c', ts: 1 },
    ];
    expect(filterNotifications(events, allOn, new Date(2026, 0, 1, 12, 0))).toHaveLength(1);
    expect(filterNotifications(events, { ...allOn, categories: { ...allOn.categories, connection: false } }, new Date(2026, 0, 1, 12, 0))).toHaveLength(0);
    expect(filterNotifications(events, { ...allOn, muted: true })).toHaveLength(0);
  });
});

describe('dueReminders', () => {
  const now = Date.UTC(2026, 5, 15);
  it('fires date reminders within the lead window, ignores done', () => {
    const due = dueReminders(
      [
        { id: '1', title: 'inspection', dueDate: now + 3 * 86_400_000, leadDays: 7 },
        { id: '2', title: 'far', dueDate: now + 30 * 86_400_000, leadDays: 7 },
        { id: '3', title: 'done', dueDate: now, done: true },
      ],
      now,
    );
    expect(due.map((r) => r.id)).toEqual(['1']);
  });

  it('fires mileage reminders when within the km lead', () => {
    const due = dueReminders([{ id: 'm', title: 'oil', dueMileageKm: 150000, leadKm: 500 }], now, 149600);
    expect(due).toHaveLength(1);
  });
});
