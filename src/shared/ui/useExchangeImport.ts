import { useCallback, useState } from 'react';
import {
  isParseError,
  loadExchangeModules,
  pickExchangeFile,
  previewImport,
  type ImportPreview,
} from '@/shared/state/exchangeService';
import type { ExchangeParseError } from '@/shared/lib/exchange';
import { isWebRuntime } from '@/shared/lib/webRuntime';

/** What the import sheet shows: a preview to confirm, or why the file was refused. */
export type PendingImport = ImportPreview | ExchangeParseError;

/** **Import profile** / **Import label pack** (plan 13): open the OS file picker, parse and
 *  validate the file, and hold the preview for `ImportPreviewSheet`. Both file kinds are accepted
 *  from either entry point. `note` explains a build without the file picker. */
export function useExchangeImport(source: string) {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const startImport = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const mods = await loadExchangeModules(source);
      const picked = mods
        ? await pickExchangeFile(mods, source)
        : { status: 'unavailable' as const };
      if (picked.status === 'unavailable') {
        // Browser: loadExchangeModules already showed the "not available on web yet" toast.
        if (isWebRuntime()) return;
        setNote('Importing needs the file picker, which this build of the app does not include.');
        return;
      }
      if (picked.status === 'cancelled') return;
      setPending(isParseError(picked.result) ? picked.result : previewImport(picked.result));
    } finally {
      setBusy(false);
    }
  }, [source]);

  const close = useCallback(() => setPending(null), []);

  return { pending, busy, note, startImport, close, setPending };
}
