import { useCallback, useState } from 'react';
import type { CapturedLine, CaptureHeader } from '@/shared/obd-core';
import { buildCaptureFile, shareCaptureFile, type CaptureFormat } from '../api/captureExport';
import { useSnifferStore } from '../model/snifferStore';

/** Write a sniffer capture (`bolid-sniff-<vehicleId>-<stamp>.csv` as `text/csv`, or `.txt` raw
 *  dump as `text/plain`) and open the OS share sheet — the error-log export pattern. Returns the
 *  file URI, or null when sharing is unavailable or the write failed (logged). */
export function useSnifferExport() {
  const [busy, setBusy] = useState(false);

  const exportCapture = useCallback(
    async (
      format: CaptureFormat,
      header: CaptureHeader,
      lines: CapturedLine[],
    ): Promise<string | null> => {
      setBusy(true);
      try {
        const uri = await shareCaptureFile(buildCaptureFile(format, header, lines));
        useSnifferStore.getState().setLastExportUri(uri);
        return uri;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { exportCapture, busy };
}
