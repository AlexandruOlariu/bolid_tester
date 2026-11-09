import { useCallback, useState } from 'react';
import { useGarageStore } from '@/shared/state/garageStore';
import { saveGarageExport } from '../api/garageExportFile';

/** **Share garage as JSON** (plan 06): a `busy` wrapper around `saveGarageExport`
 *  (`api/garageExportFile.ts`), which writes the current garage and opens the share sheet. Resolves
 *  with the file URI, or null when nothing was written (always logged). */
export function useGarageExport() {
  const [busy, setBusy] = useState(false);

  const exportGarage = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    try {
      return await saveGarageExport(useGarageStore.getState().vehicles);
    } finally {
      setBusy(false);
    }
  }, []);

  return { exportGarage, busy };
}
