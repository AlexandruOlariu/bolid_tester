/** Save a text export where the platform keeps files (plan 28):
 *  - **native** — write `<documentDirectory><name>` with expo-file-system (legacy entry point: the
 *    root one has no `documentDirectory` on this SDK) and open the OS share sheet (expo-sharing);
 *  - **web** — no file system: build a `Blob`, point a temporary `<a download>` at an object URL,
 *    click it (the browser's normal download) and revoke the URL shortly after.
 *
 *  Both native modules load through variable specifiers, so this file builds and tests without them
 *  (the dependency-tolerant idiom of `useErrorLogExport`). Pure otherwise — no React Native import,
 *  no store — so it runs in the Node test project; callers log failures under their own source. */
import { isWebRuntime } from './webRuntime';

export interface SaveTextFileOptions {
  /** Share-sheet title on native (ignored on web). */
  dialogTitle?: string;
}

/** How long the object URL outlives the click: some browsers start the download asynchronously
 *  and fail if the URL is revoked in the same task. */
export const OBJECT_URL_REVOKE_MS = 1000;

/** The DOM slice the web path uses (injectable for tests; the core typecheck has no DOM lib). */
export interface DownloadEnv {
  createObjectURL(blob: unknown): string;
  revokeObjectURL(url: string): void;
  makeBlob(body: string, mimeType: string): unknown;
  /** Create, click and remove a hidden `<a href=url download=fileName>`. */
  clickDownload(url: string, fileName: string): void;
  schedule(fn: () => void, ms: number): void;
}

interface DomAnchor {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click(): void;
}
interface DomLike {
  createElement(tag: 'a'): DomAnchor;
  body: { appendChild(el: DomAnchor): void; removeChild(el: DomAnchor): void };
}
interface UrlStatics {
  createObjectURL(blob: unknown): string;
  revokeObjectURL(url: string): void;
}
type BlobCtor = new (parts: string[], opts: { type: string }) => unknown;

/** The real browser environment. */
export function browserDownloadEnv(): DownloadEnv {
  const g = globalThis as unknown as { document: DomLike; URL: UrlStatics; Blob: BlobCtor };
  return {
    createObjectURL: (blob) => g.URL.createObjectURL(blob),
    revokeObjectURL: (url) => g.URL.revokeObjectURL(url),
    makeBlob: (body, mimeType) => new g.Blob([body], { type: mimeType }),
    clickDownload: (url, fileName) => {
      const a = g.document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      a.style.display = 'none';
      g.document.body.appendChild(a);
      try {
        a.click();
      } finally {
        g.document.body.removeChild(a);
      }
    },
    schedule: (fn, ms) => {
      setTimeout(fn, ms);
    },
  };
}

/** Download `body` as `fileName` in the browser. The object URL is always revoked, even when the
 *  click throws. */
export function downloadTextFile(
  fileName: string,
  body: string,
  mimeType: string,
  env: DownloadEnv = browserDownloadEnv(),
): string {
  const url = env.createObjectURL(env.makeBlob(body, mimeType));
  try {
    env.clickDownload(url, fileName);
  } finally {
    env.schedule(() => env.revokeObjectURL(url), OBJECT_URL_REVOKE_MS);
  }
  return fileName;
}

interface LegacyFileSystem {
  documentDirectory?: string | null;
  writeAsStringAsync(uri: string, contents: string): Promise<void>;
}
interface SharingModule {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(uri: string, opts?: { mimeType?: string; dialogTitle?: string }): Promise<void>;
}

/** Write `body` to `<documentDirectory><fileName>` and open the share sheet. Null when the platform
 *  has no document directory (nothing written). */
export async function shareTextFile(
  fileName: string,
  body: string,
  mimeType: string,
  opts: SaveTextFileOptions = {},
): Promise<string | null> {
  const FileSystem = (await import('expo-file-system/legacy' as string)) as LegacyFileSystem;
  const Sharing = (await import('expo-sharing' as string)) as SharingModule;
  const dir = FileSystem.documentDirectory ?? '';
  if (!dir) return null;
  const uri = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, body);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: opts.dialogTitle });
  }
  return uri;
}

/** Save a text export: a browser download on web, a document-directory file + share sheet on native.
 *  Resolves with the file's URI (native) or name (web), or null when nothing was written. Rejects on
 *  a real failure — the caller logs it under its own source. */
export function saveTextFile(
  fileName: string,
  body: string,
  mimeType: string,
  opts: SaveTextFileOptions = {},
): Promise<string | null> {
  if (isWebRuntime()) {
    try {
      return Promise.resolve(downloadTextFile(fileName, body, mimeType));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return shareTextFile(fileName, body, mimeType, opts);
}

/** `2026-11-09T10-00-00-000Z` — the file-name-safe timestamp every export uses. */
export function fileStamp(at: Date | number = new Date()): string {
  return new Date(at).toISOString().replace(/[:.]/g, '-');
}
