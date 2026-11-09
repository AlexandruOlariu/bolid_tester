/** Re-sharing a recorded vehicle report from the timeline (plan 16), with fake native modules. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }), {
  virtual: true,
});

import { useErrorLogStore } from '@/shared/state/errorLogStore';
import {
  loadReshareModules,
  reportFileUri,
  reshareReport,
  type ReshareModules,
} from './reportFile';

function mods(
  files: string[],
  sharing = true,
): ReshareModules & {
  shareAsync: jest.Mock;
} {
  const shareAsync = jest.fn(async () => undefined);
  return {
    FileSystem: {
      documentDirectory: 'file:///docs/',
      getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.includes(uri) })),
    },
    Sharing: { isAvailableAsync: jest.fn(async () => sharing), shareAsync },
    shareAsync,
  };
}

const entry = { fileName: 'bolid-report-WVW-20261109-0805.pdf', format: 'pdf' as const };

describe('reshareReport', () => {
  it('opens the share sheet for a file that is still on the device', async () => {
    const m = mods(['file:///docs/bolid-report-WVW-20261109-0805.pdf']);
    await expect(reshareReport(entry, m)).resolves.toBe('shared');
    expect(m.shareAsync).toHaveBeenCalledWith('file:///docs/bolid-report-WVW-20261109-0805.pdf', {
      mimeType: 'application/pdf',
      dialogTitle: 'Share vehicle report',
    });
  });

  it('reports a file that is gone without sharing anything', async () => {
    const m = mods([]);
    await expect(reshareReport(entry, m)).resolves.toBe('missing');
    expect(m.shareAsync).not.toHaveBeenCalled();
  });

  it('is unavailable without modules, a document directory or sharing', async () => {
    await expect(reshareReport(entry, null)).resolves.toBe('unavailable');
    const noDir = mods([]);
    noDir.FileSystem.documentDirectory = null;
    await expect(reshareReport(entry, noDir)).resolves.toBe('unavailable');
    const noShare = mods(['file:///docs/bolid-report-WVW-20261109-0805.pdf'], false);
    await expect(reshareReport(entry, noShare)).resolves.toBe('unavailable');
    expect(noShare.shareAsync).not.toHaveBeenCalled();
  });

  it('logs a failing share sheet and resolves unavailable', async () => {
    useErrorLogStore.getState().clear();
    const quiet = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = mods(['file:///docs/bolid-report-WVW-20261109-0805.pdf']);
    m.shareAsync.mockRejectedValueOnce(new Error('share busy'));
    await expect(reshareReport(entry, m)).resolves.toBe('unavailable');
    expect(
      useErrorLogStore.getState().errors.some((e) => e.source === 'history/reshare-report'),
    ).toBe(true);
    quiet.mockRestore();
  });
});

describe('loadReshareModules', () => {
  it('loads the legacy file system and sharing', async () => {
    const m = await loadReshareModules();
    expect(m).not.toBeNull();
    expect(typeof m?.FileSystem.getInfoAsync).toBe('function');
    expect(typeof m?.Sharing.shareAsync).toBe('function');
  });
});

describe('reportFileUri', () => {
  it('joins the document directory and the file name', () => {
    expect(reportFileUri('a.md', 'file:///docs/')).toBe('file:///docs/a.md');
    expect(reportFileUri('a.md', null)).toBeNull();
  });
});
