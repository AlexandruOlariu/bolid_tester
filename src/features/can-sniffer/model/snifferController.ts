/** One sniffer run against one DiagnosticSession, without React: start / stop the ATMA monitor,
 *  feed every line into the module-level capture and the per-id aggregator, publish a snapshot to
 *  the store every 500 ms, and release the adapter when the owner goes away (`dispose`). The
 *  `useSniffer` hook is a thin wrapper, so the run lifecycle is unit-tested in node. */
import {
  CanFrameAggregator,
  type CapturedLine,
  type CaptureHeader,
  type DiagnosticSession,
} from '@/shared/obd-core';
import { APP_VERSION } from '@/shared/lib/appInfo';
import { logError } from '@/shared/state/errorLogStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { buildCaptureHeader } from '../api/captureExport';
import { useSnifferStore } from './snifferStore';
import { snifferCapture } from './captureSession';

export const SNAPSHOT_MS = 500;

export type SnifferSession = Pick<DiagnosticSession, 'startSniffer' | 'stopSniffer' | 'sniffing'>;

export class SnifferController {
  private readonly agg = new CanFrameAggregator();
  private total = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** In-flight start() (ATH1 + ATMA setup), awaited by stop() so it never races the setup. */
  private starting: Promise<void> | null = null;
  /** This controller started the run the store reports as running. */
  private owns = false;
  private disposed = false;

  constructor(private readonly session: SnifferSession) {}

  readonly publish = (): void => {
    const s = useSnifferStore.getState();
    s.setStats(this.agg.snapshot(), this.total);
    s.setCapture(snifferCapture.buffer.size, snifferCapture.buffer.dropped);
  };

  /** Clear the previous capture, freeze the header context and start monitoring. */
  start(): Promise<void> {
    if (this.disposed || this.starting || useSnifferStore.getState().running) {
      return this.starting ?? Promise.resolve();
    }
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    this.agg.clear();
    this.total = 0;
    snifferCapture.buffer.clear();
    snifferCapture.startedAt = Date.now();
    const { info, deviceName } = useSessionStore.getState();
    snifferCapture.context = {
      vehicleId: useVehicleStore.getState().selectedProfileId,
      info,
      deviceName,
      note: useSnifferStore.getState().note,
    };
    const store = useSnifferStore.getState();
    store.reset();
    store.setRunning(true);
    this.owns = true;
    try {
      await this.session.startSniffer((line) => {
        if (this.disposed) return; // late lines after the owner left belong to no run
        snifferCapture.buffer.push(line, Date.now());
        if (this.agg.add(line)) this.total += 1;
      });
    } catch (e) {
      logError({ source: 'can-sniffer', error: e });
      this.finish();
      return;
    }
    if (this.disposed) {
      // The owner went away while ATMA was being set up: dispose() saw no monitor yet, so release
      // the adapter here instead of leaving ATMA holding the command queue with nobody to stop it.
      // (dispose() already marked the run finished; no interval is created.)
      await this.release();
      return;
    }
    this.timer = setInterval(this.publish, SNAPSHOT_MS);
  }

  /** Stop monitoring (after any in-flight start), restore headers-off and publish the final counts. */
  async stop(): Promise<void> {
    if (this.starting) await this.starting;
    this.clearTimer();
    await this.release();
    this.finish();
  }

  /** The owner (screen) went away or the session changed: never leave the adapter in monitor mode,
   *  and don't leave the store claiming a run is live. The finished capture stays shareable. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    if (this.session.sniffing) void this.release();
    this.finish();
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async release(): Promise<void> {
    try {
      await this.session.stopSniffer();
    } catch (e) {
      logError({ source: 'can-sniffer', error: e, severity: 'warning' });
    }
  }

  private finish(): void {
    if (!this.owns) return;
    this.owns = false;
    this.publish();
    useSnifferStore.getState().setRunning(false);
  }
}

/** Header + lines of the finished capture, or null while a run is live (the buffer is still
 *  filling and the adapter belongs to the monitor) or when nothing was captured. The header uses
 *  the context frozen at Start, plus the current drop count and the app version (`# app:`). */
export function finishedCapture(): { header: CaptureHeader; lines: CapturedLine[] } | null {
  const { buffer, startedAt, context } = snifferCapture;
  if (useSnifferStore.getState().running || buffer.size === 0 || !context) return null;
  const header = buildCaptureHeader({
    vehicleId: context.vehicleId,
    info: context.info,
    deviceName: context.deviceName,
    note: context.note,
    startedAt,
    dropped: buffer.dropped,
    appVersion: APP_VERSION,
  });
  return { header, lines: buffer.lines() };
}
