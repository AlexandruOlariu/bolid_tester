import {
  buildVehicleReport,
  renderReportHtml,
  renderReportMarkdown,
  reportFileStem,
  reportHeadline,
  reportSections,
  reportSeverity,
  REPORT_SECTIONS,
  SEVERITY_COLOR,
  type ReportAi,
  type ReportBattery,
  type ReportIdentity,
  type ReportInspection,
  type ReportMaintenance,
  type ReportScan,
  type VehicleReportInput,
} from './vehicleReport';
import type { DtcCheckReport } from './dtcReport';

const T = Date.UTC(2026, 10, 9, 8, 5); // 2026-11-09 08:05 UTC

const identity: ReportIdentity = {
  label: 'VW Golf Plus 2009 2.0 TDI (2009)',
  vin: 'WVWZZZ1KZ9W903398',
  vinDecoded: {
    manufacturer: 'Volkswagen',
    country: 'Germany',
    modelYear: 2009,
    checkDigitOk: null,
  },
  profileId: 'golf-plus-2009-20tdi',
  year: 2009,
  engine: '2.0 TDI',
  fuel: 'diesel',
  protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
  adapter: 'Simulator',
  elmVersion: 'ELM327 v1.5',
  voltage: 14.1,
  supportedPidCount: 28,
  calibrationId: '03L906022LM',
  connected: true,
};

const faults: DtcCheckReport = {
  ts: T,
  vehicleLabel: identity.label,
  vin: identity.vin,
  milOn: false,
  stored: [{ code: 'P0299', description: 'Turbocharger underboost' }],
  pending: [],
  permanent: [],
  monitorsComplete: 5,
  monitorsTotal: 7,
  notReady: ['EGR'],
  freezeFrames: [
    { triggerDtc: 'P0299', values: [{ name: 'Coolant temperature', value: 88, unit: '°C' }] },
  ],
};

const scan: ReportScan = {
  ts: T,
  protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
  modules: [
    {
      address: '01',
      name: 'Engine (EDC17)',
      state: 'answered',
      partNumber: '03L906022LM',
      faults: [
        {
          display: 'P0299 00',
          vagCode: '00665',
          description: 'Turbocharger underboost',
          statusText: 'confirmed',
        },
      ],
    },
  ],
  preUds: [],
  answered: 1,
  withFaults: 1,
  totalFaults: 1,
};

const inspection: ReportInspection = {
  ts: T,
  verdict: 'pass',
  score: 92,
  checks: [{ label: 'Readiness', status: 'pass', detail: '5 of 7 complete' }],
};

const battery: ReportBattery = {
  ts: T,
  restingV: 12.5,
  crankingDipV: 10.4,
  chargingV: 14.1,
  socPct: 88,
  verdict: 'good',
  notes: ['Alternator charging normally.'],
};

const ai: ReportAi = {
  ts: T,
  source: 'local',
  overall: 'ok',
  summary: 'No urgent faults.',
  findings: [
    { title: 'Boost', severity: 'info', detail: 'Check the boost hose.', codes: ['P0299'] },
  ],
  disclaimer: 'Not a substitute for a mechanic.',
};

const maintenance: ReportMaintenance = {
  odoKm: 182000,
  due: [
    {
      name: 'Engine oil & filter',
      status: 'ok',
      dueInKm: 12000,
      dueInDays: 300,
      lastOdoKm: 179000,
      lastDate: T,
    },
  ],
};

function full(overrides: Partial<VehicleReportInput> = {}): VehicleReportInput {
  return {
    identity,
    faults,
    scan,
    inspection,
    battery,
    ai,
    maintenance,
    include: [...REPORT_SECTIONS],
    appVersion: '0.4.0',
    now: T,
    ...overrides,
  };
}

describe('buildVehicleReport', () => {
  it('keeps every requested section that has data, and lists none as missing', () => {
    const m = buildVehicleReport(full());
    expect(reportSections(m)).toEqual(REPORT_SECTIONS);
    expect(m.missing).toEqual([]);
    expect(m.generatedAt).toBe(T);
    expect(m.appVersion).toBe('0.4.0');
  });

  it('lists the sections requested without data in `missing`, in document order', () => {
    const m = buildVehicleReport(full({ battery: null, scan: undefined, ai: null }));
    expect(m.missing).toEqual(['scan', 'battery', 'ai']);
    expect(m.battery).toBeNull();
    expect(reportSections(m)).toEqual(['faults', 'inspection', 'maintenance']);
  });

  it('drops a section that was not requested, even when it has data (and does not call it missing)', () => {
    const m = buildVehicleReport(full({ include: ['faults', 'maintenance'], maintenance: null }));
    expect(m.scan).toBeNull();
    expect(m.inspection).toBeNull();
    expect(reportSections(m)).toEqual(['faults']);
    expect(m.missing).toEqual(['maintenance']);
  });
});

describe('reportSeverity (the header badge)', () => {
  it('is ok for a clean car', () => {
    expect(reportSeverity(buildVehicleReport(full()))).toBe('ok');
  });

  it('MIL on → urgent (red badge)', () => {
    const m = buildVehicleReport(full({ faults: { ...faults, milOn: true } }));
    expect(reportSeverity(m)).toBe('urgent');
    expect(renderReportHtml(m)).toContain('<span class="badge sev-urgent">URGENT</span>');
    expect(renderReportHtml(m)).toContain(
      `.badge.sev-urgent { background: ${SEVERITY_COLOR.urgent}; }`,
    );
  });

  it('an overdue service item → at least attention', () => {
    const overdue: ReportMaintenance = {
      ...maintenance,
      due: [{ ...maintenance.due[0], status: 'overdue', dueInKm: -400 }],
    };
    expect(reportSeverity(buildVehicleReport(full({ maintenance: overdue })))).toBe('attention');
    // …and the worse signal still wins.
    expect(
      reportSeverity(
        buildVehicleReport(full({ maintenance: overdue, ai: { ...ai, overall: 'urgent' } })),
      ),
    ).toBe('urgent');
  });

  it('takes the inspection verdict and a weak battery into account', () => {
    expect(
      reportSeverity(buildVehicleReport(full({ inspection: { ...inspection, verdict: 'fail' } }))),
    ).toBe('urgent');
    expect(
      reportSeverity(
        buildVehicleReport(full({ inspection: { ...inspection, verdict: 'caution' } })),
      ),
    ).toBe('attention');
    expect(
      reportSeverity(buildVehicleReport(full({ battery: { ...battery, verdict: 'weak' } }))),
    ).toBe('attention');
  });

  it('ignores signals from sections that were left out', () => {
    const m = buildVehicleReport(
      full({ faults: { ...faults, milOn: true }, include: ['maintenance'] }),
    );
    expect(reportSeverity(m)).toBe('ok');
  });
});

describe('reportFileStem', () => {
  it('uses the VIN when present', () => {
    expect(reportFileStem(buildVehicleReport(full()))).toBe(
      'bolid-report-WVWZZZ1KZ9W903398-20261109-0805',
    );
  });

  it('falls back to the profile id, made file-name safe', () => {
    const m = buildVehicleReport(
      full({ identity: { ...identity, vin: null, profileId: 'user:abc123' } }),
    );
    expect(reportFileStem(m)).toBe('bolid-report-user-abc123-20261109-0805');
  });
});

describe('renderReportMarkdown', () => {
  const headings = (md: string) => md.split('\n').filter((l) => l.startsWith('## '));

  it('has one `## ` heading per present section', () => {
    const md = renderReportMarkdown(buildVehicleReport(full()));
    expect(headings(md)).toEqual([
      '## Fault codes & readiness',
      '## Module scan',
      '## Used-car inspection',
      '## Battery & charging',
      '## AI diagnosis',
      '## Maintenance due',
    ]);
    const partial = renderReportMarkdown(
      buildVehicleReport(full({ include: ['faults', 'battery'], battery: null })),
    );
    expect(headings(partial)).toEqual(['## Fault codes & readiness']);
    expect(partial).toContain('_Not run yet: Battery & charging._');
  });

  it('carries the identity, codes, scan faults and due list', () => {
    const md = renderReportMarkdown(buildVehicleReport(full()));
    expect(md.startsWith('# Vehicle report — VW Golf Plus 2009 2.0 TDI (2009)')).toBe(true);
    expect(md).toContain('- VIN: WVWZZZ1KZ9W903398');
    expect(md).toContain('  - P0299 (VAG 00665) — Turbocharger underboost');
    expect(md).toContain('  - 00665 - P0299 00 - Turbocharger underboost (confirmed)');
    expect(md).toContain('- Verdict: PASS (score 92/100)');
    expect(md).toContain('- Odometer: 182 000 km');
    expect(md).toContain('- Engine oil & filter: ok — in 12 000 km · in 300 days');
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('renderReportHtml', () => {
  it('is a self-contained document with the shared stylesheet and print page breaks', () => {
    const html = renderReportHtml(buildVehicleReport(full()));
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
    expect(html).toContain('.meta-row { display: flex;'); // the lifted REPORT_CSS
    expect(html).toContain('@media print { .page-break { break-before: page; } }');
    expect(html).toContain('<h2 class="section page-break" id="sec-scan">');
    expect(html).toContain('<h2 class="section page-break" id="sec-maintenance">');
    expect(html).toContain('<h2 class="section" id="sec-faults">');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('renders sections in model order', () => {
    const html = renderReportHtml(buildVehicleReport(full()));
    const at = (id: string) => html.indexOf(`id="sec-${id}"`);
    const order = REPORT_SECTIONS.map(at);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('escapes <script> in a DTC description (and everywhere else)', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderReportHtml(
      buildVehicleReport(
        full({
          faults: { ...faults, stored: [{ code: 'P0299', description: evil }] },
          ai: { ...ai, summary: evil },
          identity: { ...identity, label: `Golf ${evil}` },
        }),
      ),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('is metric only — no mph, miles or °F', () => {
    const html = renderReportHtml(buildVehicleReport(full()));
    expect(html).not.toMatch(/\bmph\b/i);
    expect(html).not.toMatch(/\bmi\b/);
    expect(html).not.toMatch(/\bmiles?\b/i);
    expect(html).not.toContain('°F');
    expect(html).toContain('182 000 km');
    expect(html).toContain('88 °C');
    expect(html).toContain('12.50 V');
  });

  it('shows a muted "not run yet" line for requested sections without data', () => {
    const html = renderReportHtml(buildVehicleReport(full({ battery: null, ai: null })));
    expect(html).toContain(
      '<p class="missing">Not run yet: Battery &amp; charging, AI diagnosis.</p>',
    );
  });

  it('says "last connection" in the identity block when built offline', () => {
    const offline: ReportIdentity = {
      ...identity,
      connected: false,
      adapter: null,
      elmVersion: null,
      voltage: null,
      supportedPidCount: null,
      calibrationId: null,
      lastSeenAt: T,
    };
    const html = renderReportHtml(buildVehicleReport(full({ identity: offline })));
    expect(html).toContain(
      'not connected — details from the last connection (2026-11-09 08:05 UTC)',
    );
    expect(html).not.toContain('Supported PIDs');
  });
});

describe('reportHeadline', () => {
  it('summarises each present section', () => {
    expect(reportHeadline(buildVehicleReport(full()))).toBe(
      '1 fault code · 1/1 modules answered, 1 module fault · inspection PASS · battery good · AI ok · 0 service items overdue',
    );
    expect(reportHeadline(buildVehicleReport(full({ include: [] })))).toBe('identity only');
  });
});
