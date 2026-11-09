import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { memoryFiles } from '@test/mocks/fileSystem';
import { connectSimulator } from '@test/simulator';
import {
  analyzeBattery,
  assessInspection,
  localHeuristicReport,
  PROTOCOL_LABELS,
} from '@/shared/obd-core';
import { getVehicleProfile, vehicleLabel } from '@/shared/vehicles';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useDtcStore } from '@/shared/state/dtcStore';
import { useHistoryStore, type ReportHistoryEntry } from '@/shared/state/historyStore';
import * as dtcService from '@/features/fault-codes/api/dtcService';
import { scanModule } from '@/features/module-scan/api/moduleScanService';
import { buildSavedScan, useScanHistoryStore } from '@/features/module-scan/model/scanHistoryStore';
import { useInspectionStore } from '@/features/inspection/model/inspectionStore';
import { useBatteryStore } from '@/features/battery-health/model/batteryStore';
import { useAiDiagnoseStore } from '@/features/ai-diagnose/model/aiDiagnoseStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';
import { NOT_ON_WEB_YET, hideToast, useToastStore } from '@/shared/state/toastStore';
import { ReportScreen } from './ReportScreen';

// The UI project cannot run the export's variable-specifier `import('expo-print')` & co. (babel
// leaves it to the VM), so the loader hands over the same test doubles jest.setup.ui.ts installs;
// the real loader is covered by api/reportExport.test.ts in the core project.
jest.mock('../api/reportExport', () => {
  const actual = jest.requireActual<object>('../api/reportExport');
  return {
    ...actual,
    loadReportModules: jest.fn(async () => ({
      FileSystem:
        jest.requireActual<typeof import('@test/mocks/fileSystem')>('@test/mocks/fileSystem')
          .fileSystemMock,
      Sharing: jest.requireMock('expo-sharing'),
      Print: jest.requireMock('expo-print'),
    })),
  };
});
const reportExport = jest.requireMock('../api/reportExport') as {
  loadReportModules: jest.Mock;
};
const actualReportExport =
  jest.requireActual<typeof import('../api/reportExport')>('../api/reportExport');

const GOLF = 'golf-plus-2009-20tdi';
const SECTION_TITLES = [
  'Fault codes & readiness',
  'Module scan',
  'Used-car inspection',
  'Battery & charging',
  'AI diagnosis',
  'Maintenance due',
];

const sharing = jest.requireMock('expo-sharing') as {
  isAvailableAsync: jest.Mock;
  shareAsync: jest.Mock;
};
const print = jest.requireMock('expo-print') as { printToFileAsync: jest.Mock };

function fileEnding(ext: string): [string, string] | undefined {
  return [...memoryFiles.entries()].find(([k]) => k.endsWith(ext) && k.includes('bolid-report-'));
}

function latestReportEntry(): ReportHistoryEntry {
  const e = useHistoryStore.getState().entries[0];
  if (!e || e.kind !== 'report') throw new Error('no report entry in history');
  return e;
}

/** Faults + Module scan + Inspection + Battery + AI (local fallback) + one maintenance entry, all
 *  against the simulated Golf with P0299 injected — the plan's simulator walk-through. */
async function runEverything(): Promise<void> {
  useVehicleStore.setState({ selectedProfileId: GOLF });
  await connectSimulator({ vehicleId: GOLF, injectedDtcs: ['P0299'] });
  const { session, info } = useSessionStore.getState();
  if (!session || !info) throw new Error('no session');
  const profile = getVehicleProfile(GOLF);

  await act(async () => {
    const read = await dtcService.readAll();
    if (!read) throw new Error('no fault read');
    useDtcStore.getState().set(read);

    const results = [];
    for (const m of profile.modules ?? []) results.push(await scanModule(session, m));
    await session.setHeader(null);
    useScanHistoryStore.getState().saveScan(
      buildSavedScan({
        vehicle: { id: profile.id, label: vehicleLabel(profile), vin: info.vin },
        protocol: PROTOCOL_LABELS[info.protocol],
        results,
      }),
    );

    useInspectionStore.getState().set({
      report: assessInspection({
        vinValid: true,
        readiness: read.readiness,
        stored: read.stored,
        pending: read.pending,
        permanent: read.permanent,
      }),
      ranAt: Date.now(),
    });
    useBatteryStore
      .getState()
      .setReport(analyzeBattery([12.5, 10.4, 14.1, 14.2].map((v, i) => ({ t: i * 200, v }))));
    useAiDiagnoseStore.getState().setReport(
      localHeuristicReport({
        protocol: info.protocol,
        vin: info.vin,
        voltage: info.voltage,
        supportedPidCount: info.supportedPids.length,
        readiness: read.readiness,
        dtcs: { stored: read.stored, pending: read.pending, permanent: read.permanent },
        freezeFrame: read.freezeFrames[0] ?? null,
        live: [],
      }),
      null,
    );
    useMaintenanceStore
      .getState()
      .addEntry([`id:${GOLF}`], { itemId: 'engine-oil', date: Date.now(), odoKm: 180000 });
  });
}

describe('ReportScreen', () => {
  afterEach(() => {
    sharing.isAvailableAsync.mockResolvedValue(false);
  });

  it('nothing run yet: every section is disabled with "Not run yet" and a working "Run now"', async () => {
    renderWithProviders(<ReportScreen />);

    for (const title of SECTION_TITLES) {
      const box = screen.getByRole('checkbox', { name: title });
      expect(box.props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    }
    expect(screen.getAllByText('Not run yet')).toHaveLength(6);

    fireEvent.press(screen.getByLabelText('Run now: Battery & charging'));
    expect(mockPush).toHaveBeenCalledWith('/battery');
    fireEvent.press(screen.getByLabelText('Run now: Module scan'));
    expect(mockPush).toHaveBeenCalledWith('/module-scan');
  });

  it('offline: the HTML still builds from stored data and says "last connection"', async () => {
    renderWithProviders(<ReportScreen />);
    expect(
      screen.getByText(/Not connected — identity and results from the last connection/),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Share HTML'));
    });
    const file = fileEnding('.html');
    expect(file).toBeDefined();
    expect(file?.[1]).toContain('not connected — details from the last connection');
    expect(file?.[1]).toContain('Not run yet: Fault codes &amp; readiness, Module scan');
    expect(latestReportEntry()).toMatchObject({ format: 'html', sections: [] });
  });

  it('after running everything on the simulator: six enabled sections, Share PDF writes a .pdf', async () => {
    sharing.isAvailableAsync.mockResolvedValue(true);
    await runEverything();
    renderWithProviders(<ReportScreen />);

    for (const title of SECTION_TITLES) {
      const box = screen.getByRole('checkbox', { name: title });
      expect({ title, ...box.props.accessibilityState }).toMatchObject({
        title,
        checked: true,
        disabled: false,
      });
    }
    expect(screen.queryByText('Not run yet')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Share PDF'));
    });
    expect(print.printToFileAsync).toHaveBeenCalledTimes(1);
    const html = (print.printToFileAsync.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain('<td class="vag">00665</td>'); // P0299
    expect(html).toContain('<td class="code">01</td>');
    expect(html).toContain('Engine oil &amp; filter');

    const pdf = fileEnding('.pdf');
    expect(pdf?.[0]).toMatch(/bolid-report-WVWZZZ1KZ9W903398-\d{8}-\d{4}\.pdf$/);
    expect(memoryFiles.has('file:///test-cache/print.pdf')).toBe(false); // moved, not copied
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      pdf?.[0],
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
    const entry = latestReportEntry();
    expect(entry).toMatchObject({ format: 'pdf', vehicle: { id: GOLF, vin: 'WVWZZZ1KZ9W903398' } });
    expect(entry.sections).toHaveLength(6);
    expect(await screen.findByText(/Saved bolid-report-.*\.pdf/)).toBeTruthy();
  });

  it('unchecking a section removes it from the document', async () => {
    await runEverything();
    renderWithProviders(<ReportScreen />);

    fireEvent.press(screen.getByRole('checkbox', { name: 'Battery & charging' }));
    expect(
      screen.getByRole('checkbox', { name: 'Battery & charging' }).props.accessibilityState,
    ).toMatchObject({ checked: false, disabled: false });

    await act(async () => {
      fireEvent.press(screen.getByText('Share HTML'));
    });
    const html = fileEnding('.html')?.[1] ?? '';
    expect(html).toContain('id="sec-faults"');
    expect(html).not.toContain('id="sec-battery"');
    expect(html).not.toContain('Not run yet'); // left out on purpose, not missing
    expect(latestReportEntry().sections).not.toContain('battery');
    expect(latestReportEntry().sections).toHaveLength(5);
  });

  it('falls back to HTML when the PDF printer is unavailable', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    print.printToFileAsync.mockRejectedValueOnce(new Error('no printer'));
    renderWithProviders(<ReportScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Share PDF'));
    });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('PDF unavailable', expect.any(String)));
    expect(fileEnding('.html')).toBeDefined();
    expect(fileEnding('.pdf')).toBeUndefined();
    expect(latestReportEntry().format).toBe('html');
    alert.mockRestore();
    quiet.mockRestore();
  });

  it('in the browser, Share PDF shows the one "not on web yet" toast and no second dialog', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderWithProviders(<ReportScreen />);
    const g = globalThis as { document?: unknown };
    // The real loader's web guard (toast + null), with the web runtime faked (`isWebRuntime`).
    reportExport.loadReportModules.mockImplementationOnce(actualReportExport.loadReportModules);
    reportExport.loadReportModules.mockClear();
    g.document = { createElement: () => ({}) };
    try {
      await act(async () => {
        fireEvent.press(screen.getByText('Share PDF'));
      });
    } finally {
      delete g.document;
    }
    expect(useToastStore.getState().toast?.message).toBe(NOT_ON_WEB_YET);
    expect(reportExport.loadReportModules).toHaveBeenCalledTimes(1); // no HTML retry
    expect(alert).not.toHaveBeenCalled();
    expect(fileEnding('.pdf')).toBeUndefined();
    hideToast();
    alert.mockRestore();
  });

  it('Share Markdown writes a .md with a heading per section', async () => {
    await runEverything();
    renderWithProviders(<ReportScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Share Markdown'));
    });
    const md = fileEnding('.md')?.[1] ?? '';
    expect(md.split('\n').filter((l) => l.startsWith('## '))).toHaveLength(6);
    expect(latestReportEntry().format).toBe('md');
  });
});
