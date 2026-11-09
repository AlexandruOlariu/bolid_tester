/** End-to-end (plan 15): the simulated Golf with an injected P0299 → every section of the unified
 *  vehicle report built from real core results — the Mode 03 read + readiness + freeze frames, a
 *  UDS read of the engine module (address 01), the inspection assessment, a battery analysis, the
 *  local (offline) AI fallback and one maintenance entry. Built from plain objects, not stores. */
import { DiagnosticSession } from '../obd-core/session/DiagnosticSession';
import { MockTransport } from '../obd-core/transport/MockTransport';
import { buildScenario } from '../obd-core/transport/scenarios';
import { readModuleDtcs, readModuleIdent } from '../obd-core/uds/udsModule';
import { assessInspection } from '../obd-core/analysis/inspection';
import { analyzeBattery } from '../obd-core/analysis/battery';
import { localHeuristicReport } from '../obd-core/analysis/aiDiagnosis';
import { computeDue, DEFAULT_SERVICE_ITEMS } from '../obd-core/analysis/maintenance';
import { PROTOCOL_LABELS } from '../obd-core/obd/protocols';
import { dtcCheckFromRead } from './dtcReport';
import {
  buildVehicleReport,
  renderReportHtml,
  renderReportMarkdown,
  reportSections,
  REPORT_SECTIONS,
  type ReportScan,
} from './vehicleReport';

const NOW = Date.UTC(2026, 10, 9, 12, 0);
const DAY = 24 * 60 * 60 * 1000;

async function simulatedGolfReport() {
  const transport = new MockTransport(
    buildScenario('golf-plus-2009-20tdi', { storedDtcs: ['P0299'] }),
  );
  const session = new DiagnosticSession(transport);
  const info = await session.connect();

  // Faults (the Faults screen's read).
  const stored = await session.readDtcs('03');
  const pending = await session.readDtcs('07');
  const permanent = await session.readDtcs('0A');
  const readiness = await session.readReadiness();
  const freezeFrames = await session.readFreezeFrames();
  const faults = dtcCheckFromRead(
    { stored, pending, permanent, readiness, freezeFrames },
    info,
    'VW Golf Plus 2009 2.0 TDI (2009)',
    { ts: NOW, adapter: 'Simulator' },
  );

  // Module scan: the engine module on its UDS header.
  await session.setHeader('7E0');
  const send = (cmd: string) => session.send(cmd);
  const ident = await readModuleIdent(send);
  const engineDtcs = await readModuleDtcs(send, 0xff);
  await session.setHeader(null);
  const scan: ReportScan = {
    ts: NOW,
    protocol: PROTOCOL_LABELS[info.protocol],
    modules: [
      {
        address: '01',
        name: 'Engine',
        state: 'answered',
        partNumber: ident.partNumber,
        systemName: ident.systemName,
        faults: engineDtcs.map((d) => ({
          display: d.display,
          vagCode: d.vagCode,
          description: d.description,
          statusText: 'stored',
        })),
      },
    ],
    preUds: [],
    answered: 1,
    withFaults: engineDtcs.length ? 1 : 0,
    totalFaults: engineDtcs.length,
  };

  const insp = assessInspection({
    vinValid: true,
    readiness,
    stored,
    pending,
    permanent,
    freezeFramePresent: freezeFrames.length > 0,
  });
  const bat = analyzeBattery(
    [12.5, 12.5, 10.4, 12.0, 14.1, 14.2, 14.1].map((v, i) => ({ t: NOW + i * 200, v })),
  );
  const aiReport = localHeuristicReport({
    protocol: info.protocol,
    vin: info.vin,
    voltage: info.voltage,
    supportedPidCount: info.supportedPids.length,
    readiness,
    dtcs: { stored, pending, permanent },
    freezeFrame: freezeFrames[0] ?? null,
    live: [],
  });
  const entries = [{ id: 'e1', itemId: 'engine-oil', date: NOW - 400 * DAY, odoKm: 160000 }];
  const due = computeDue(DEFAULT_SERVICE_ITEMS, entries, { odoKm: 180000, now: NOW });

  return buildVehicleReport({
    identity: {
      label: 'VW Golf Plus 2009 2.0 TDI (2009)',
      vin: info.vin,
      profileId: 'golf-plus-2009-20tdi',
      protocol: PROTOCOL_LABELS[info.protocol],
      adapter: 'Simulator',
      elmVersion: info.version,
      voltage: info.voltage,
      supportedPidCount: info.supportedPids.length,
      calibrationId: info.calibrationId,
      connected: true,
    },
    faults,
    scan,
    inspection: { ts: NOW, ...insp },
    battery: { ts: NOW, ...bat },
    ai: { ts: NOW, ...aiReport },
    maintenance: { odoKm: 180000, due },
    include: [...REPORT_SECTIONS],
    now: NOW,
  });
}

describe('unified vehicle report against the simulated Golf with P0299', () => {
  it('has all six sections and nothing missing', async () => {
    const model = await simulatedGolfReport();
    expect(reportSections(model)).toEqual(REPORT_SECTIONS);
    expect(model.missing).toEqual([]);
    expect(model.faults?.stored.map((d) => d.code)).toContain('P0299');
  });

  it('the HTML carries the VAG number, module 01, the inspection verdict and the due list', async () => {
    const model = await simulatedGolfReport();
    const html = renderReportHtml(model);
    expect(html).toContain('P0299');
    expect(html).toContain('<td class="vag">00665</td>'); // P0299 → 0x0299 = 665
    expect(html).toContain('<td class="code">01</td>');
    expect(html).toContain(model.scan?.modules[0].partNumber ?? 'no part number');
    const verdict = model.inspection?.verdict ?? 'none';
    expect(html).toContain(`<span class="chip ${verdict}">${verdict.toUpperCase()}</span>`);
    expect(html).toContain('Engine oil &amp; filter');
    expect(html).toContain('OVERDUE'); // 400 days and 20 000 km since the last oil change
    expect(html).toContain('WVWZZZ1KZ9W903398');
    expect(html).not.toMatch(/\bmph\b|°F/);
  });

  it('the Markdown has a heading per section', async () => {
    const md = renderReportMarkdown(await simulatedGolfReport());
    expect(md.split('\n').filter((l) => l.startsWith('## '))).toHaveLength(6);
    expect(md).toContain('00665');
  });
});
