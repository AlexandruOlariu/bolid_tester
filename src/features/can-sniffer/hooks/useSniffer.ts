import { useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '@/shared/state/sessionStore';
import { SnifferController, finishedCapture } from '../model/snifferController';
import type { CaptureFormat } from '../api/captureExport';
import { useSnifferExport } from './useSnifferExport';

/** Raw bus monitor (ELM327 ATMA): stream frames, aggregate per CAN id, and keep every line in a
 *  bounded capture that can be shared as CSV / raw dump after Stop. While sniffing, the adapter
 *  channel belongs to the monitor — all other polling pauses. The run lifecycle lives in
 *  `SnifferController` (one per session); this hook binds it to the screen. */
export function useSniffer() {
  const session = useSessionStore((s) => s.session);
  const status = useSessionStore((s) => s.status);
  const { exportCapture, busy } = useSnifferExport();
  const controller = useRef<SnifferController | null>(null);

  const available = !!session && status === 'connected';
  // Over Classic Bluetooth (SPP) the link only carries prompt-terminated replies, so ATMA cannot
  // stream (plan 27): the screen explains that instead of offering Start.
  const canMonitor = session?.canMonitor ?? true;

  // One controller per session. Cleanup (unmount or session change) never leaves the adapter in
  // monitor mode — including when it happens while start() is still setting ATMA up.
  useEffect(() => {
    if (!session) return;
    const c = new SnifferController(session);
    controller.current = c;
    return () => {
      c.dispose();
      if (controller.current === c) controller.current = null;
    };
  }, [session]);

  const start = useCallback(async () => {
    await controller.current?.start();
  }, []);

  const stop = useCallback(async () => {
    await controller.current?.stop();
  }, []);

  /** Share the finished capture. Refused (null) while running and when nothing was captured. */
  const exportAs = useCallback(
    async (format: CaptureFormat): Promise<string | null> => {
      const capture = finishedCapture();
      if (!capture) return null;
      return exportCapture(format, capture.header, capture.lines);
    },
    [exportCapture],
  );

  const exportCsv = useCallback(() => exportAs('csv'), [exportAs]);
  const exportRaw = useCallback(() => exportAs('raw'), [exportAs]);

  return { available, canMonitor, start, stop, exportCsv, exportRaw, exporting: busy };
}
