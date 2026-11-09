/** saveTextFile (plan 28): a browser download on web (object URL created, clicked, revoked), the
 *  document directory + share sheet on native. */
const files = new Map<string, string>();
const fsMock = {
  documentDirectory: '/docs/' as string | null,
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
};
const sharingMock = {
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
};
jest.mock('expo-file-system/legacy', () => fsMock);
jest.mock('expo-sharing', () => sharingMock);

import {
  OBJECT_URL_REVOKE_MS,
  downloadTextFile,
  fileStamp,
  saveTextFile,
  type DownloadEnv,
} from './saveFile';
import { isWebRuntime } from './webRuntime';

function fakeEnv(opts: { clickThrows?: boolean } = {}) {
  const calls: string[] = [];
  const blobs: { body: string; type: string }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const env: DownloadEnv = {
    makeBlob: (body, type) => {
      blobs.push({ body, type });
      return { body, type };
    },
    createObjectURL: () => {
      calls.push('create');
      return 'blob:https://example.test/1';
    },
    revokeObjectURL: (url) => calls.push(`revoke ${url}`),
    clickDownload: (url, name) => {
      calls.push(`click ${url} ${name}`);
      if (opts.clickThrows) throw new Error('blocked');
    },
    schedule: (fn, ms) => timers.push({ fn, ms }),
  };
  return { env, calls, blobs, timers };
}

describe('downloadTextFile (web)', () => {
  it('creates an object URL, clicks a download link, then revokes the URL', () => {
    const { env, calls, blobs, timers } = fakeEnv();
    expect(downloadTextFile('bolid-errors.md', '# Errors', 'text/markdown', env)).toBe(
      'bolid-errors.md',
    );
    expect(blobs).toEqual([{ body: '# Errors', type: 'text/markdown' }]);
    expect(calls).toEqual(['create', 'click blob:https://example.test/1 bolid-errors.md']);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(OBJECT_URL_REVOKE_MS);
    timers[0].fn();
    expect(calls).toEqual([
      'create',
      'click blob:https://example.test/1 bolid-errors.md',
      'revoke blob:https://example.test/1',
    ]);
  });

  it('still revokes the URL when the click throws', () => {
    const { env, calls, timers } = fakeEnv({ clickThrows: true });
    expect(() => downloadTextFile('x.txt', 'x', 'text/plain', env)).toThrow('blocked');
    timers.forEach((t) => t.fn());
    expect(calls).toContain('revoke blob:https://example.test/1');
  });
});

describe('saveTextFile', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, URL: g.URL, Blob: g.Blob };

  beforeEach(() => {
    files.clear();
    fsMock.documentDirectory = '/docs/';
    sharingMock.isAvailableAsync.mockImplementation(async () => true);
  });
  afterEach(() => {
    jest.useRealTimers();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  });

  it('on native writes the document-directory file and opens the share sheet', async () => {
    expect(isWebRuntime()).toBe(false);
    const uri = await saveTextFile('scan.txt', 'report', 'text/plain', { dialogTitle: 'Share' });
    expect(uri).toBe('/docs/scan.txt');
    expect(files.get('/docs/scan.txt')).toBe('report');
    expect(sharingMock.shareAsync).toHaveBeenCalledWith('/docs/scan.txt', {
      mimeType: 'text/plain',
      dialogTitle: 'Share',
    });
  });

  it('on native without a document directory writes nothing', async () => {
    fsMock.documentDirectory = null;
    await expect(saveTextFile('a.txt', 'a', 'text/plain')).resolves.toBeNull();
    expect(files.size).toBe(0);
  });

  it('on web downloads through the DOM and never touches the file system', async () => {
    jest.useFakeTimers();
    const anchors: Record<string, unknown>[] = [];
    const body = {
      children: [] as unknown[],
      appendChild(el: unknown) {
        this.children.push(el);
      },
      removeChild(el: unknown) {
        this.children = this.children.filter((c) => c !== el);
      },
    };
    g.document = {
      createElement: () => {
        const a: Record<string, unknown> = { style: {}, clicked: 0 };
        a.click = () => {
          a.clicked = (a.clicked as number) + 1;
        };
        anchors.push(a);
        return a;
      },
      body,
    };
    const created: unknown[] = [];
    const revoked: string[] = [];
    g.URL = {
      createObjectURL: (b: unknown) => {
        created.push(b);
        return 'blob:fake';
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    };
    g.Blob = class {
      constructor(
        readonly parts: string[],
        readonly opts: { type: string },
      ) {}
    };
    expect(isWebRuntime()).toBe(true);

    await expect(saveTextFile('bolid-errors.md', '# E', 'text/markdown')).resolves.toBe(
      'bolid-errors.md',
    );
    expect(created).toEqual([
      expect.objectContaining({ parts: ['# E'], opts: { type: 'text/markdown' } }),
    ]);
    expect(anchors).toEqual([
      expect.objectContaining({ href: 'blob:fake', download: 'bolid-errors.md', clicked: 1 }),
    ]);
    expect(body.children).toHaveLength(0);
    expect(revoked).toEqual([]);
    jest.advanceTimersByTime(OBJECT_URL_REVOKE_MS);
    expect(revoked).toEqual(['blob:fake']);
    expect(fsMock.writeAsStringAsync).not.toHaveBeenCalled();
  });
});

describe('fileStamp', () => {
  it('is a file-name-safe ISO timestamp', () => {
    expect(fileStamp(Date.UTC(2026, 10, 9, 10, 0, 0))).toBe('2026-11-09T10-00-00-000Z');
  });
});
