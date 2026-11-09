/** Writing / sharing the vehicle report (plan 15) with fake native modules. The persisted stores'
 *  file layer and the three tolerant imports are mocked (virtual: `expo-print` has no Node build). */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }), {
  virtual: true,
});
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }), { virtual: true });

import { useHistoryStore } from '@/shared/state/historyStore';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import { buildVehicleReport, type ReportIdentity } from '@/shared/lib/vehicleReport';
import {
  exportVehicleReport,
  loadReportModules,
  type ReportFileSystem,
  type ReportModules,
} from './reportExport';

const T = Date.UTC(2026, 10, 9, 8, 5);

const identity: ReportIdentity = {
  label: 'VW Golf Plus (2009)',
  vin: 'WVWZZZ1KZ9W903398',
  profileId: 'golf-plus-2009-20tdi',
  protocol: null,
  adapter: null,
  elmVersion: null,
  voltage: null,
  supportedPidCount: null,
  calibrationId: null,
  connected: false,
};

const model = buildVehicleReport({
  identity,
  faults: {
    ts: T,
    milOn: false,
    stored: [{ code: 'P0299', description: 'Underboost' }],
    pending: [],
    permanent: [],
  },
  include: ['faults', 'battery'],
  now: T,
});
const STEM = 'bolid-report-WVWZZZ1KZ9W903398-20261109-0805';

function fakes(over: Partial<ReportModules> = {}) {
  const files = new Map<string, string>();
  const FileSystem: ReportFileSystem = {
    documentDirectory: 'file:///docs/',
    writeAsStringAsync: jest.fn(async (uri: string, body: string) => {
      files.set(uri, body);
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    }),
  };
  const Sharing = {
    isAvailableAsync: jest.fn(async () => true),
    shareAsync: jest.fn(async () => undefined),
  };
  const Print = {
    printToFileAsync: jest.fn(async ({ html }: { html: string }) => {
      files.set('file:///cache/print.pdf', `PDF of ${html.length} chars`);
      return { uri: 'file:///cache/print.pdf' };
    }),
  };
  return { files, mods: { FileSystem, Sharing, Print, ...over } as ReportModules, Sharing, Print };
}

beforeEach(() => {
  useHistoryStore.setState({ entries: [] });
  useErrorLogStore.setState({ errors: [] });
});

describe('exportVehicleReport', () => {
  it('HTML: writes <stem>.html, records it in history and shares text/html', async () => {
    const { files, mods, Sharing } = fakes();
    const uri = await exportVehicleReport(model, 'html', mods);
    expect(uri).toBe(`file:///docs/${STEM}.html`);
    expect(files.get(uri ?? '')).toContain('<!DOCTYPE html>');
    expect(files.get(uri ?? '')).toContain('Not run yet: Battery &amp; charging.');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, {
      mimeType: 'text/html',
      dialogTitle: 'Share vehicle report',
    });
    expect(useHistoryStore.getState().entries[0]).toMatchObject({
      kind: 'report',
      vehicle: { id: 'golf-plus-2009-20tdi', label: 'VW Golf Plus (2009)', vin: identity.vin },
      sections: ['faults'],
      format: 'html',
      fileName: `${STEM}.html`,
    });
  });

  it('PDF: prints the HTML, moves it to <stem>.pdf and shares application/pdf', async () => {
    const { files, mods, Sharing, Print } = fakes();
    const uri = await exportVehicleReport(model, 'pdf', mods);
    expect(uri).toBe(`file:///docs/${STEM}.pdf`);
    expect(Print.printToFileAsync).toHaveBeenCalledWith({
      html: expect.stringContaining('<td class="vag">00665</td>'),
    });
    expect(files.has('file:///cache/print.pdf')).toBe(false);
    expect(files.get(uri ?? '')).toMatch(/^PDF of \d+ chars$/);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      uri,
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
    expect(useHistoryStore.getState().entries[0]).toMatchObject({
      format: 'pdf',
      fileName: `${STEM}.pdf`,
    });
  });

  it('Markdown: writes <stem>.md', async () => {
    const { files, mods } = fakes();
    const uri = await exportVehicleReport(model, 'md', mods);
    expect(uri).toBe(`file:///docs/${STEM}.md`);
    expect(files.get(uri ?? '')).toContain('## Fault codes & readiness');
  });

  it('PDF without a printer resolves null and writes nothing (the screen falls back to HTML)', async () => {
    const { files, mods } = fakes({ Print: null });
    expect(await exportVehicleReport(model, 'pdf', mods)).toBeNull();
    expect(files.size).toBe(0);
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it('no document directory or no modules → null', async () => {
    const { mods } = fakes();
    expect(
      await exportVehicleReport(model, 'html', {
        ...mods,
        FileSystem: { ...mods.FileSystem, documentDirectory: null },
      }),
    ).toBeNull();
    expect(await exportVehicleReport(model, 'html', null)).toBeNull();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it('a failed write is logged as report/export and not recorded', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { mods } = fakes();
    mods.FileSystem.writeAsStringAsync = jest.fn(async () => {
      throw new Error('disk full');
    });
    expect(await exportVehicleReport(model, 'md', mods)).toBeNull();
    expect(useErrorLogStore.getState().errors[0]).toMatchObject({
      source: 'report/export',
      message: 'disk full',
    });
    expect(useHistoryStore.getState().entries).toHaveLength(0);
    quiet.mockRestore();
  });

  it('a failing share sheet after the write still resolves the file (no second copy)', async () => {
    const quiet = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { files, mods, Sharing } = fakes();
    Sharing.shareAsync.mockRejectedValueOnce(new Error('Another share request is being processed'));
    const uri = await exportVehicleReport(model, 'pdf', mods);
    expect(uri).toBe(`file:///docs/${STEM}.pdf`);
    expect(files.has(uri ?? '')).toBe(true);
    expect(useHistoryStore.getState().entries).toHaveLength(1);
    expect(useErrorLogStore.getState().errors[0]).toMatchObject({
      source: 'report/export',
      severity: 'warning',
    });
    quiet.mockRestore();
  });

  it('does not open the share sheet where sharing is unavailable, but still returns the file', async () => {
    const { mods, Sharing } = fakes();
    Sharing.isAvailableAsync.mockResolvedValueOnce(false);
    expect(await exportVehicleReport(model, 'html', mods)).toBe(`file:///docs/${STEM}.html`);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('loadReportModules', () => {
  it('loads the legacy file system, sharing and print', async () => {
    const mods = await loadReportModules();
    expect(mods?.FileSystem.documentDirectory).toBe('file:///docs/');
    expect(typeof mods?.Sharing.shareAsync).toBe('function');
    expect(typeof mods?.Print?.printToFileAsync).toBe('function');
  });
});
