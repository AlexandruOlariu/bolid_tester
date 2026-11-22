/** Error-log export in the browser (plan 28 acceptance): a `.md` file is downloaded through an
 *  object URL — there is no file system there. The native write + share path is covered by
 *  `shared/lib/saveFile.test.ts` (this project cannot run the variable-specifier `import()`). */
import { act, renderHook } from '@testing-library/react-native';
import { memoryFiles } from '@test/mocks/fileSystem';
import { buildLoggedError } from '@/shared/lib/errorLog';
import { useErrorLogExport } from './useErrorLogExport';

const errors = [buildLoggedError({ source: 'connection', error: new Error('ATZ timed out') })];

describe('useErrorLogExport', () => {
  describe('in the browser', () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { document: g.document, URL: g.URL, Blob: g.Blob };
    const clicked: { href: string; download: string }[] = [];
    const blobs: { parts: string[]; type: string }[] = [];

    beforeEach(() => {
      jest.useFakeTimers();
      clicked.length = 0;
      blobs.length = 0;
      g.document = {
        createElement: () => {
          const a = { href: '', download: '', rel: '', style: {}, click: () => clicked.push(a) };
          return a;
        },
        body: { appendChild: () => undefined, removeChild: () => undefined },
      };
      g.URL = { createObjectURL: () => 'blob:errors', revokeObjectURL: jest.fn() };
      g.Blob = class {
        constructor(parts: string[], opts: { type: string }) {
          blobs.push({ parts, type: opts.type });
        }
      };
    });
    afterEach(() => {
      jest.useRealTimers();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
    });

    it('downloads a .md file instead of writing to a file system', async () => {
      const writes = memoryFiles.size;
      const { result } = renderHook(() => useErrorLogExport());
      let name: string | null = null;
      await act(async () => {
        name = await result.current.exportErrors(errors, 'md');
      });
      expect(name).toMatch(/^bolid-errors-.*\.md$/);
      expect(clicked).toEqual([expect.objectContaining({ href: 'blob:errors', download: name })]);
      expect(blobs[0].type).toBe('text/markdown');
      expect(blobs[0].parts.join('')).toContain('ATZ timed out');
      expect(memoryFiles.size).toBe(writes);
      jest.runAllTimers();
      expect((g.URL as { revokeObjectURL: jest.Mock }).revokeObjectURL).toHaveBeenCalledWith(
        'blob:errors',
      );
    });
  });
});
