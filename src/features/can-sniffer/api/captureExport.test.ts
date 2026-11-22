/** Sniffer capture export (plan 03): header from the session, file name / MIME per format, and the
 *  write + share path against mocked native modules. */
const files = new Map<string, string>();
const fsMock = {
  documentDirectory: '/docs/' as string | null,
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  deleteAsync: jest.fn(async () => undefined),
};
const sharingMock = {
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
};
jest.mock('expo-file-system/legacy', () => fsMock);
jest.mock('expo-sharing', () => sharingMock);

import { CaptureBuffer, type SessionInfo } from '@/shared/obd-core';
import { useErrorLogStore } from '@/shared/state/errorLogStore';
import {
  buildCaptureFile,
  buildCaptureHeader,
  captureFileName,
  shareCaptureFile,
} from './captureExport';

const INFO: SessionInfo = {
  protocol: 'ISO_15765_4_CAN_11_500',
  voltage: 12.4,
  version: 'ELM327 v1.5',
  supportedPids: [],
  vin: null,
  calibrationId: null,
};
const NOW = new Date(Date.UTC(2026, 10, 8, 10, 30, 0, 123));

function capture() {
  const buf = new CaptureBuffer();
  const t0 = NOW.getTime();
  buf.push('7E0 02 10 03', t0 + 5);
  buf.push('7E8 06 50 03 00 32 01 F4', t0 + 9);
  buf.push('BUFFER FULL', t0 + 12);
  return { t0, lines: buf.lines() };
}

beforeEach(() => {
  files.clear();
  fsMock.documentDirectory = '/docs/';
  sharingMock.isAvailableAsync.mockImplementation(async () => true);
  fsMock.writeAsStringAsync.mockImplementation(async (uri: string, value: string) => {
    files.set(uri, value);
  });
  useErrorLogStore.setState({ errors: [] });
});

describe('buildCaptureHeader', () => {
  it('takes protocol + adapter version from the session and the device name when known', () => {
    const h = buildCaptureHeader({
      vehicleId: 'golf-plus-2009-20tdi',
      info: INFO,
      deviceName: 'IOS-Vlink',
      startedAt: 1,
      note: '  VCDS Group 121  ',
      dropped: 4,
    });
    expect(h).toEqual({
      vehicleId: 'golf-plus-2009-20tdi',
      protocol: 'ISO_15765_4_CAN_11_500',
      adapter: 'ELM327 v1.5 (IOS-Vlink)',
      startedAt: 1,
      note: 'VCDS Group 121',
      appVersion: undefined,
      dropped: 4,
    });
  });

  it('leaves unknown fields empty without a session', () => {
    const h = buildCaptureHeader({ vehicleId: 'generic', info: null, startedAt: 1, note: '  ' });
    expect(h.protocol).toBeUndefined();
    expect(h.adapter).toBeUndefined();
    expect(h.note).toBeUndefined();
    expect(h.dropped).toBe(0);
  });
});

describe('capture file', () => {
  it('names files bolid-sniff-<vehicleId>-<stamp> with a safe id', () => {
    expect(captureFileName('golf-plus-2009-20tdi', 'csv', NOW)).toBe(
      'bolid-sniff-golf-plus-2009-20tdi-2026-11-08T10-30-00-123Z.csv',
    );
    expect(captureFileName('a/b c', 'raw', NOW)).toBe(
      'bolid-sniff-a-b-c-2026-11-08T10-30-00-123Z.txt',
    );
    expect(captureFileName('', 'csv', NOW)).toMatch(/^bolid-sniff-unknown-/);
  });

  it('CSV is text/csv with one row per frame; raw is text/plain with every line', () => {
    const { t0, lines } = capture();
    const header = buildCaptureHeader({
      vehicleId: 'golf-plus-2009-20tdi',
      info: INFO,
      startedAt: t0,
      note: 'idle',
    });
    const csv = buildCaptureFile('csv', header, lines, NOW);
    expect(csv.mimeType).toBe('text/csv');
    expect(csv.fileName.endsWith('.csv')).toBe(true);
    expect(csv.body.split('\n')[0]).toBe('# bolid-tester bus capture (csv)');
    expect(csv.body).toContain('# note: idle\n');
    expect(csv.body).toContain('\n5,7E0,3,02 10 03\n9,7E8,7,06 50 03 00 32 01 F4\n');

    const raw = buildCaptureFile('raw', header, lines, NOW);
    expect(raw.mimeType).toBe('text/plain');
    expect(raw.fileName.endsWith('.txt')).toBe(true);
    expect(
      raw.body
        .trimEnd()
        .split('\n')
        .filter((r) => !r.startsWith('#')),
    ).toHaveLength(3);
  });
});

describe('shareCaptureFile', () => {
  it('writes the body to the document directory and opens the share sheet', async () => {
    const { t0, lines } = capture();
    const file = buildCaptureFile(
      'csv',
      buildCaptureHeader({ vehicleId: 'golf', info: INFO, startedAt: t0 }),
      lines,
      NOW,
    );
    const uri = await shareCaptureFile(file);
    expect(uri).toBe(`/docs/${file.fileName}`);
    expect(files.get(uri as string)).toBe(file.body);
    expect(sharingMock.shareAsync).toHaveBeenCalledWith(uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Share bus capture',
    });
  });

  it('still saves when no share sheet is available', async () => {
    sharingMock.isAvailableAsync.mockImplementation(async () => false);
    const file = { fileName: 'x.txt', mimeType: 'text/plain', body: 'b' };
    expect(await shareCaptureFile(file)).toBe('/docs/x.txt');
    expect(sharingMock.shareAsync).not.toHaveBeenCalled();
  });

  it('returns null without a document directory', async () => {
    fsMock.documentDirectory = null;
    expect(
      await shareCaptureFile({ fileName: 'x.csv', mimeType: 'text/csv', body: '' }),
    ).toBeNull();
    expect(
      fsMock.writeAsStringAsync.mock.calls.some(([uri]) => String(uri).endsWith('x.csv')),
    ).toBe(false);
  });

  it('logs a failed write to the error log and returns null', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fsMock.writeAsStringAsync.mockImplementation(async (uri: string, value: string) => {
      if (uri.endsWith('x.csv')) throw new Error('disk full');
      files.set(uri, value);
    });
    expect(
      await shareCaptureFile({ fileName: 'x.csv', mimeType: 'text/csv', body: '' }),
    ).toBeNull();
    const errors = useErrorLogStore.getState().errors;
    expect(errors[0]?.source).toBe('can-sniffer/export');
  });
});
