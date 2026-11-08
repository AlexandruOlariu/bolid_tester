/** In-memory expo-file-system test double for the `ui` Jest project: zustand-persist stores write
 *  through `fileStateStorage` into this Map, and `resetStores()` empties it between tests. Serves both
 *  the `expo-file-system/legacy` entry point (persistStorage) and the plain `expo-file-system` one
 *  that the export hooks import with a variable specifier. */
export const memoryFiles = new Map<string, string>();

export const fileSystemMock = {
  documentDirectory: 'file:///test/',
  cacheDirectory: 'file:///test-cache/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: memoryFiles.has(uri), uri })),
  readAsStringAsync: jest.fn(async (uri: string) => {
    const v = memoryFiles.get(uri);
    if (v === undefined) throw new Error(`ENOENT: ${uri}`);
    return v;
  }),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    memoryFiles.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    memoryFiles.delete(uri);
  }),
  makeDirectoryAsync: jest.fn(async () => undefined),
};
