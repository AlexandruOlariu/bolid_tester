import { formatDtcCheck, formatDtcReport, type DtcCheckReport } from './dtcReport';

const T = Date.UTC(2026, 0, 2, 3, 4, 5); // 2026-01-02T03:04:05.000Z

function dtc(code: string, description = `${code} desc`) {
  return { code, description };
}

const liveRead: DtcCheckReport = {
  ts: T,
  vehicleLabel: 'VW Golf',
  vin: 'WVWZZZ1KZAW000001',
  milOn: true,
  stored: [dtc('P0299', 'Turbo underboost')],
  pending: [],
  permanent: [dtc('P0420', 'Catalyst efficiency')],
  monitorsComplete: 6,
  monitorsTotal: 8,
  notReady: ['EVAP', 'Catalyst'],
  freezeFrame: {
    triggerDtc: 'P0299',
    values: [
      { name: 'Engine RPM', value: 2200, unit: 'rpm' },
      { name: 'Coolant', value: 89, unit: '°C' },
    ],
  },
};

describe('formatDtcCheck', () => {
  it('renders vehicle, MIL, monitors, codes and freeze frame for a live read', () => {
    const s = formatDtcCheck(liveRead);
    expect(s).toContain('## VW Golf — 2026-01-02T03:04:05.000Z');
    expect(s).toContain('- VIN: WVWZZZ1KZAW000001');
    expect(s).toContain('- MIL: ON');
    expect(s).toContain('- Monitors: 6/8 complete');
    expect(s).toContain('- Not ready: EVAP, Catalyst');
    expect(s).toContain('- Stored (1):');
    expect(s).toContain('  - P0299 — Turbo underboost');
    expect(s).toContain('- Pending (0): none');
    expect(s).toContain('  - P0420 — Catalyst efficiency');
    expect(s).toContain('- Freeze frame (captured when P0299 set):');
    expect(s).toContain('  - Engine RPM: 2200 rpm');
  });

  it('shows MIL as unknown and omits monitors/VIN when not provided', () => {
    const s = formatDtcCheck({
      ts: T,
      vehicleLabel: null,
      milOn: null,
      stored: [],
      pending: [],
      permanent: [],
    });
    expect(s).toContain('## Unknown vehicle — ');
    expect(s).toContain('- MIL: unknown');
    expect(s).not.toContain('- VIN:');
    expect(s).not.toContain('- Monitors:');
    expect(s).not.toContain('Freeze frame');
  });
});

describe('formatDtcReport', () => {
  it('emits an empty-state document when there are no checks', () => {
    const doc = formatDtcReport([], { now: T });
    expect(doc).toContain('# Bolid Tester — fault codes');
    expect(doc).toContain('Exported: 2026-01-02T03:04:05.000Z');
    expect(doc).toContain('Checks: 0');
    expect(doc).toContain('Total codes: 0');
    expect(doc).toContain('_No fault-code checks to export._');
  });

  it('counts checks and total codes, honours a custom title, and ends with a newline', () => {
    const second: DtcCheckReport = {
      ts: T + 1000,
      vehicleLabel: 'Audi A3',
      milOn: false,
      stored: [dtc('P0101')],
      pending: [dtc('P0113')],
      permanent: [],
    };
    const doc = formatDtcReport([liveRead, second], {
      title: 'Bolid Tester — fault-code history',
      now: T,
    });
    expect(doc.startsWith('# Bolid Tester — fault-code history')).toBe(true);
    expect(doc).toContain('Checks: 2');
    // liveRead: 1 stored + 1 permanent = 2; second: 1 stored + 1 pending = 2 -> 4
    expect(doc).toContain('Total codes: 4');
    // order preserved (newest-first as given)
    expect(doc.indexOf('VW Golf')).toBeLessThan(doc.indexOf('Audi A3'));
    expect(doc.endsWith('\n')).toBe(true);
  });

  it('includes the app version line only when provided', () => {
    expect(formatDtcReport([], { appVersion: '0.1.0', now: T })).toContain('App version: 0.1.0');
    expect(formatDtcReport([], { now: T })).not.toContain('App version:');
  });
});
