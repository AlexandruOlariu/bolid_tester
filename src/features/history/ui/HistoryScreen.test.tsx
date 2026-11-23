/** History — the per-car timeline (plan 16): every source on one list grouped by day, the car /
 *  kind / text filters, the deep links (scan compare, trip detail, maintenance), the AI report
 *  sheet, report re-share, and what Clear deletes. */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { mockPush } from '@test/mocks/router';
import { memoryFiles } from '@test/mocks/fileSystem';
import {
  useHistoryStore,
  type AiHistoryEntry,
  type HistoryVehicle,
  type TrailRow,
} from '@/shared/state/historyStore';
import type { AiReport } from '@/shared/obd-core';
import { useScanHistoryStore, type SavedScan } from '@/features/module-scan/model/scanHistoryStore';
import { useTripStore, type TripSummary } from '@/features/trip-recording/model/tripStore';
import { useMaintenanceStore } from '@/features/maintenance/model/maintenanceStore';
import { useCarBackupStore } from '@/features/coding/model/carBackupStore';
import { AiEntryBody, HistoryScreen } from './HistoryScreen';
import { formatDate } from '@/shared/lib/format';
import { i18n } from '@/shared/i18n';

// The UI project cannot run the variable-specifier `import('expo-sharing')` & co. (babel leaves it
// to the VM), so the loader hands over the test doubles jest.setup.ui.ts installs; the real loader
// is covered by api/reportFile.test.ts in the core project.
jest.mock('../api/reportFile', () => {
  const actual = jest.requireActual<object>('../api/reportFile');
  return {
    ...actual,
    loadReshareModules: async () => ({
      FileSystem:
        jest.requireActual<typeof import('@test/mocks/fileSystem')>('@test/mocks/fileSystem')
          .fileSystemMock,
      Sharing: jest.requireMock('expo-sharing'),
    }),
  };
});

// Export goes through the fault-codes slice's `useDtcExport` (its file / share path is covered on
// the Faults screen); here the test checks what History hands it.
const mockExportReport = jest.fn(async (_baseName: string, _body: string) => 'file:///test/x.md');
jest.mock('@/features/fault-codes', () => ({
  ...jest.requireActual<object>('@/features/fault-codes'),
  useDtcExport: () => ({ exportReport: mockExportReport, busy: false }),
}));

const GOLF: HistoryVehicle = { id: 'golf-plus-2009-20tdi', label: 'VW Golf Plus', vin: null };
const PUNTO: HistoryVehicle = { id: 'fiat-punto-2008-12', label: 'Fiat Punto', vin: null };

// Everything happens "today" at fixed local hours, so the day grouping is deterministic.
const today = new Date();
const at = (h: number, m = 0) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).getTime();
const yesterday = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() - 1,
  12,
).getTime();

const aiReport: AiReport = {
  overall: 'attention',
  summary: 'Boost is below target under load.',
  findings: [
    { title: 'Underboost', severity: 'warn', detail: 'Check the vacuum lines.', codes: ['P0299'] },
  ],
  actions: [{ type: 'inspect', label: 'Inspect the boost hoses' }],
  source: 'local',
  disclaimer: 'Not a substitute for a mechanic.',
};

function scan(id: string, ts: number, faults: number): SavedScan {
  return {
    id,
    ts,
    vehicle: GOLF,
    protocol: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
    tp20: null,
    modules: [
      {
        address: '01',
        name: 'Engine',
        state: 'ok',
        dtcs: Array.from({ length: faults }, () => ({
          sae: 'P0299',
          display: 'P0299 00',
          vagCode: '00665',
          description: 'Turbocharger underboost',
          status: 0x09,
        })),
      },
    ],
  };
}

const trip: TripSummary = {
  header: {
    id: 'trip-1',
    startedAt: at(9),
    endedAt: at(9) + 30_000,
    profileId: GOLF.id,
    vin: null,
    protocol: 'AUTO',
  },
  stats: { durationMs: 30_000, sampleCount: 15, distanceKm: 0.42, max: {} },
  markerCount: 0,
  vehicleId: GOLF.id,
};

function seedAllSources(): void {
  const h = useHistoryStore.getState();
  h.addAiRun({
    ts: at(8),
    vehicle: GOLF,
    source: 'local',
    overall: 'attention',
    summary: aiReport.summary,
    findingCount: 1,
    report: aiReport,
  });
  h.addDtcCheck({
    ts: at(8, 10),
    vehicle: GOLF,
    milOn: false,
    stored: [{ code: 'P0299', description: 'Underboost' }],
    pending: [],
    permanent: [],
    monitorsComplete: null,
    monitorsTotal: null,
  });
  h.addReportRun({
    ts: at(10),
    vehicle: GOLF,
    sections: ['faults', 'scan', 'maintenance'],
    format: 'pdf',
    fileName: 'bolid-report-golf.pdf',
  });
  // Two Golf scans: the first with the fault, the second after it was cleared (newest first).
  useScanHistoryStore.setState({
    scans: [scan('scan-2', at(8, 40), 0), scan('scan-1', at(8, 20), 1)],
  });
  useTripStore.setState({ trips: [trip] });
  useMaintenanceStore.setState({
    byVehicle: {
      [`id:${GOLF.id}`]: {
        entries: [{ id: 'svc-1', itemId: 'engine-oil', date: at(11), odoKm: 182000 }],
        odoKm: 182000,
        kmPerYear: 15000,
      },
    },
  });
  useCarBackupStore.setState({
    backups: [{ id: 'bk-1', ts: at(7), vehicle: GOLF, protocol: 'CAN', modules: [] }],
  });
}

describe('HistoryScreen — timeline (plan 16)', () => {
  beforeEach(seedAllSources);

  it('lists every source newest first under one day header', () => {
    renderWithProviders(<HistoryScreen />);
    const rows = screen.getAllByTestId(/^timeline-/);
    expect(rows.map((r) => r.props.testID)).toEqual([
      'timeline-maintenance:svc-1',
      `timeline-report:${useHistoryStore.getState().entries[0].id}`,
      'timeline-trip:trip-1',
      'timeline-scan:scan-2',
      'timeline-scan:scan-1',
      `timeline-dtc:${useHistoryStore.getState().entries[1].id}`,
      `timeline-ai:${useHistoryStore.getState().entries[2].id}`,
      'timeline-backup:bk-1',
    ]);
    expect(screen.getByText(formatDate(at(12)))).toBeTruthy();
    expect(screen.getByText('Service: Engine oil & filter')).toBeTruthy();
    expect(screen.getByText('Report (PDF)')).toBeTruthy();
    expect(
      screen.getByText('Fault codes & readiness · Module scan · Maintenance due'),
    ).toBeTruthy();
    expect(screen.getByText('Trip · 0.4 km')).toBeTruthy();
    expect(screen.getByText('Auto-scan · 1 fault')).toBeTruthy();
    expect(screen.getByText('Fault-code check')).toBeTruthy();
    expect(screen.getByText('AI diagnosis · needs attention')).toBeTruthy();
    expect(screen.getByText('Coding backup')).toBeTruthy();
  });

  it('rebuilds the item texts when the language changes while History stays mounted (plan 11)', async () => {
    renderWithProviders(<HistoryScreen />);
    expect(screen.getByText('Trip · 0.4 km')).toBeTruthy();
    expect(screen.getByText('Fault-code check')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    expect(screen.getByText('Călătorie · 0,4 km')).toBeTruthy();
    expect(screen.getByText('Verificare coduri de eroare')).toBeTruthy();
    expect(screen.queryByText('Trip · 0.4 km')).toBeNull();
  });

  it('groups items of another day under their own header', () => {
    useTripStore.setState({
      trips: [{ ...trip, header: { ...trip.header, startedAt: yesterday } }],
    });
    renderWithProviders(<HistoryScreen />);
    expect(screen.getByText(formatDate(yesterday))).toBeTruthy();
    expect(screen.getByText(formatDate(at(12)))).toBeTruthy();
  });

  it('kind chips combine, and the text filter narrows', () => {
    renderWithProviders(<HistoryScreen />);
    fireEvent.press(screen.getByText('Scans (2)'));
    expect(screen.getAllByTestId(/^timeline-/)).toHaveLength(2);
    fireEvent.press(screen.getByText('Trips (1)'));
    expect(screen.getAllByTestId(/^timeline-/)).toHaveLength(3);
    expect(screen.queryByText('Coding backup')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Filter the timeline'), '1 FAULT');
    expect(screen.getAllByTestId(/^timeline-/)).toHaveLength(1);
    expect(screen.getByText('Auto-scan · 1 fault')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Filter the timeline'), 'no such thing');
    expect(screen.getByText('Nothing matches “no such thing”.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Filter the timeline'), '');
    fireEvent.press(screen.getByText('All'));
    expect(screen.getAllByTestId(/^timeline-/)).toHaveLength(8);
  });

  it('the car chip filters every source', () => {
    useHistoryStore.getState().addDtcCheck({
      ts: at(12),
      vehicle: PUNTO,
      milOn: true,
      stored: [],
      pending: [],
      permanent: [],
      monitorsComplete: null,
      monitorsTotal: null,
    });
    renderWithProviders(<HistoryScreen />);
    expect(screen.getByText('All cars (9)')).toBeTruthy();
    fireEvent.press(screen.getByText('Fiat Punto (1)'));
    expect(screen.getAllByTestId(/^timeline-/)).toHaveLength(1);
    fireEvent.press(screen.getByText(/^VW Golf.*\(8\)$/));
    expect(screen.getAllByTestId(/^timeline-/)).toHaveLength(8);
    expect(screen.queryByText('0 stored · 0 pending · MIL on')).toBeNull();
  });

  it('a scan opens Module scan with this scan as After and the previous one as Before', () => {
    renderWithProviders(<HistoryScreen />);
    fireEvent.press(screen.getByText('Auto-scan · 0 faults'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/module-scan',
      params: { after: 'scan-2', before: 'scan-1' },
    });
  });

  it('a trip opens its detail, a service entry the maintenance log, a backup Coding', () => {
    renderWithProviders(<HistoryScreen />);
    fireEvent.press(screen.getByText('Trip · 0.4 km'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/trip-detail', params: { id: 'trip-1' } });
    fireEvent.press(screen.getByText('Service: Engine oil & filter'));
    expect(mockPush).toHaveBeenCalledWith('/maintenance');
    fireEvent.press(screen.getByText('Coding backup'));
    expect(mockPush).toHaveBeenCalledWith('/coding');
  });

  it('a report whose file is gone explains it; one still on the device re-shares', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderWithProviders(<HistoryScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Report (PDF)'));
    });
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'File no longer on device',
        expect.stringContaining('bolid-report-golf.pdf'),
      ),
    );

    memoryFiles.set('file:///test/bolid-report-golf.pdf', '%PDF-1.4');
    const sharing = jest.requireMock('expo-sharing') as {
      isAvailableAsync: jest.Mock;
      shareAsync: jest.Mock;
    };
    sharing.isAvailableAsync.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.press(screen.getByText('Report (PDF)'));
    });
    await waitFor(() =>
      expect(sharing.shareAsync).toHaveBeenCalledWith(
        'file:///test/bolid-report-golf.pdf',
        expect.objectContaining({ mimeType: 'application/pdf' }),
      ),
    );
    alert.mockRestore();
  });

  it('Clear deletes only the AI / fault-code / report records', () => {
    const alert = jest.spyOn(Alert, 'alert');
    renderWithProviders(<HistoryScreen />);
    fireEvent.press(screen.getByText('Clear'));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(alert.mock.calls[0][1]).toMatch(
      /Module scans, trips, service entries and coding backups are kept/,
    );
    act(() => buttons.find((b) => b.text === 'Clear')?.onPress?.());
    expect(useHistoryStore.getState().entries).toHaveLength(0);
    expect(useScanHistoryStore.getState().scans).toHaveLength(2);
    expect(useTripStore.getState().trips).toHaveLength(1);
    expect(useCarBackupStore.getState().backups).toHaveLength(1);
    expect(screen.queryByText('Fault-code check')).toBeNull();
    expect(screen.getByText('Coding backup')).toBeTruthy();
    alert.mockRestore();
  });

  it('an AI run opens its saved report in a sheet', () => {
    renderWithProviders(<HistoryScreen />);
    expect(screen.queryByText('Findings (1)')).toBeNull();
    fireEvent.press(screen.getByText('AI diagnosis · needs attention'));
    expect(screen.getByText('Findings (1)')).toBeTruthy();
    expect(screen.getByText('Inspect the boost hoses')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a fault-guide button in the AI sheet closes the sheet before it navigates', () => {
    renderWithProviders(<HistoryScreen />);
    fireEvent.press(screen.getByText('AI diagnosis · needs attention'));
    expect(screen.getByText('Findings (1)')).toBeTruthy();
    fireEvent.press(screen.getByText('Related data'));
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/extended\?dids=/));
    expect(screen.queryByText('Findings (1)')).toBeNull();
  });

  it('Export is offered while fault-code checks are listed', () => {
    renderWithProviders(<HistoryScreen />);
    expect(screen.getByText('Export')).toBeTruthy();
    fireEvent.press(screen.getByText('Trips (1)'));
    expect(screen.queryByText('Export')).toBeNull();
  });

  it('Export shares the listed fault-code checks as the Markdown report', async () => {
    useHistoryStore.getState().addDtcCheck({
      ts: at(12),
      vehicle: PUNTO,
      milOn: true,
      stored: [{ code: 'P0420', description: 'Catalyst efficiency below threshold' }],
      pending: [],
      permanent: [],
      monitorsComplete: null,
      monitorsTotal: null,
    });
    renderWithProviders(<HistoryScreen />);
    // Only the Golf's check is listed once its car chip is selected.
    fireEvent.press(screen.getByText(/^VW Golf.*\(8\)$/));
    await act(async () => {
      fireEvent.press(screen.getByText('Export'));
    });
    expect(mockExportReport).toHaveBeenCalledTimes(1);
    const [baseName, body] = mockExportReport.mock.calls[0];
    expect(baseName).toBe('bolid-fault-history');
    expect(body).toMatch(/^# Bolid Tester — fault-code history/);
    expect(body).toContain('Checks: 1');
    expect(body).toContain('P0299');
    expect(body).not.toContain('P0420');
  });
});

describe('HistoryScreen — AI report sheet', () => {
  it('renders the saved run’s full report', () => {
    renderWithProviders(
      <AiEntryBody
        entry={{
          kind: 'ai',
          id: 'a1',
          ts: at(8),
          vehicle: { ...GOLF, vin: 'WVWZZZ1KZ9W903398' },
          source: 'local',
          overall: 'attention',
          summary: aiReport.summary,
          findingCount: 1,
          report: aiReport,
        }}
      />,
    );
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Boost is below target under load.')).toBeTruthy();
    expect(screen.getByText('Findings (1)')).toBeTruthy();
    expect(screen.getByText('Underboost')).toBeTruthy();
    expect(screen.getByText('Inspect the boost hoses')).toBeTruthy();
    expect(screen.getByText('VIN WVWZZZ1KZ9W903398')).toBeTruthy();
  });
});

describe('HistoryScreen — AI run trail (plan 34d)', () => {
  const trail: TrailRow[] = [
    {
      id: 1,
      kind: 'triage',
      why: '',
      digest: 'Codes: P0299\nBattery: 12.6 V',
      summary: '1 code, battery 12.6 V',
      label: { key: 'aiDiagnose:agent.step.triage', values: { count: 1, volts: '12.6' } },
      status: 'ok',
    },
    {
      id: 2,
      kind: 'tool',
      tool: 'read_live',
      why: 'Check boost against the target',
      digest: 'MAP 98 kPa',
      summary: 'MAP 98 kPa',
      label: { key: 'aiDiagnose:agent.tool.read_live', values: { pids: 'MAP' } },
      status: 'ok',
    },
  ];
  const base = {
    vehicle: GOLF,
    source: 'ai' as const,
    overall: 'attention' as const,
    summary: aiReport.summary,
    findingCount: 1,
    report: aiReport,
  };

  function seedHistory(): { withTrail: AiHistoryEntry; withoutTrail: AiHistoryEntry } {
    const h = useHistoryStore.getState();
    // Saved before plan 34d: no trail, request or end.
    h.addAiRun({ ...base, ts: at(8) });
    h.addAiRun({
      ...base,
      ts: at(9),
      trail,
      request: { mode: 'symptom', symptom: 'pulls weak' },
      end: 'final',
    });
    const [withTrail, withoutTrail] = useHistoryStore.getState().entries as AiHistoryEntry[];
    return { withTrail, withoutTrail };
  }

  const openEntry = (e: AiHistoryEntry) =>
    act(async () => {
      fireEvent.press(screen.getByTestId(`timeline-ai:${e.id}`));
    });

  it('re-opens a run with its trail; an old run without one shows no trail', async () => {
    const { withTrail, withoutTrail } = seedHistory();
    renderWithProviders(<HistoryScreen />);

    await openEntry(withTrail);
    // Collapsed and read-only: the header with the step count, no Stop.
    expect(screen.getByText('Investigation · 2 steps')).toBeTruthy();
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByText(/Triage — /)).toBeNull();
    fireEvent.press(screen.getByText('Investigation · 2 steps'));
    expect(screen.getByText(/Triage — /)).toBeTruthy();
    expect(screen.getByText('Live data — MAP')).toBeTruthy();
    expect(screen.getByText('Check boost against the target')).toBeTruthy();
    fireEvent.press(screen.getAllByText('Show data')[1]);
    expect(screen.getByText('MAP 98 kPa')).toBeTruthy();

    await openEntry(withoutTrail);
    expect(screen.getByText('Findings (1)')).toBeTruthy();
    expect(screen.queryByText(/Triage — /)).toBeNull();
    expect(screen.queryByText(/^Investigation · /)).toBeNull();
  });
});

describe('HistoryScreen — empty', () => {
  it('explains what will appear', () => {
    renderWithProviders(<HistoryScreen />);
    expect(screen.getByText(/^Nothing yet\./)).toBeTruthy();
    expect(screen.queryByText('Clear')).toBeNull();
  });
});
