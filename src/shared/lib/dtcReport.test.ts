import { formatDtcCheck, formatDtcReport, buildDtcReportHtml, type DtcCheckReport } from './dtcReport';

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

describe('buildDtcReportHtml', () => {
  const check: DtcCheckReport = {
    ...liveRead,
    protocol: 'ISO 15765-4 (CAN 11/500)',
    voltage: 14.2,
    adapter: 'Simulator',
    monitorsComplete: 6,
    monitorsTotal: 8,
  };

  it('is a self-contained HTML document with inline CSS', () => {
    const html = buildDtcReportHtml(check, { now: T });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toContain('<link'); // no external stylesheet
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('renders vehicle, VIN, protocol, adapter, voltage and readiness', () => {
    const html = buildDtcReportHtml(check, { now: T });
    expect(html).toContain('VW Golf');
    expect(html).toContain('WVWZZZ1KZAW000001');
    expect(html).toContain('ISO 15765-4 (CAN 11/500)');
    expect(html).toContain('Simulator');
    expect(html).toContain('14.2 V');
    expect(html).toContain('6/8 monitors complete');
    expect(html).toContain('MIL ON');
  });

  it('lists stored/pending/permanent codes with their VAG cross-reference numbers', () => {
    const html = buildDtcReportHtml(check, { now: T });
    expect(html).toContain('P0299'); // stored
    expect(html).toContain('P0420'); // permanent
    // P0420 -> 0x0420 = 1056 -> '01056'
    expect(html).toContain('01056');
    expect(html).toContain('Turbo underboost');
  });

  it('includes freeze-frame values when captured', () => {
    const html = buildDtcReportHtml(check, { now: T });
    expect(html).toContain('Freeze frame');
    expect(html).toContain('Engine RPM');
    expect(html).toContain('2200 rpm');
  });

  it('escapes HTML-significant characters from decoder text', () => {
    const html = buildDtcReportHtml({
      ts: T,
      vehicleLabel: 'Fiat <Punto> & "Co"',
      milOn: false,
      stored: [{ code: 'P0100', description: 'Mass air <flow> & sensor' }],
      pending: [],
      permanent: [],
    });
    expect(html).toContain('Fiat &lt;Punto&gt; &amp; &quot;Co&quot;');
    expect(html).toContain('Mass air &lt;flow&gt; &amp; sensor');
    expect(html).not.toContain('<Punto>');
  });

  it('shows a muted "none" row and MIL off badge for a clean car', () => {
    const html = buildDtcReportHtml({
      ts: T,
      vehicleLabel: 'Clean Car',
      milOn: false,
      stored: [],
      pending: [],
      permanent: [],
    });
    expect(html).toContain('MIL off');
    expect(html).toContain('none');
    expect(html).toContain('0 fault codes');
  });
});
