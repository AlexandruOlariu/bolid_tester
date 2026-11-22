/** The current sniffer capture, held at module level (not in a component ref) so a finished run
 *  can still be shared after the screen is left and reopened. One capture at a time:
 *  `SnifferController.start()` clears it. */
import { CaptureBuffer, type SessionInfo } from '@/shared/obd-core';

/** What the capture header describes, frozen when the run starts — so changing the selected car,
 *  reconnecting to another adapter or editing the note between Stop and Share cannot rewrite it. */
export interface CaptureContext {
  vehicleId: string;
  info: SessionInfo | null;
  deviceName: string | null;
  note: string;
}

export const snifferCapture = {
  buffer: new CaptureBuffer(),
  /** When the current capture started (ms since epoch); 0 = nothing captured yet. */
  startedAt: 0,
  /** Header context recorded at Start; null = nothing captured yet. */
  context: null as CaptureContext | null,
};
