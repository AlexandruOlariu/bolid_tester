/** Live facts about the current / latest connect attempt, for the Connect screen's diagnostics
 *  panel: what the BLE link negotiated (MTU, characteristics, write mode), the furthest stage the
 *  attempt reached, the device it targeted (sessionStore only learns the device on success), and
 *  when it started (so the panel only shows this attempt's adapter-log lines).
 *  Written by connectionService; in-memory only. See docs/features/connection.md. */
import { create } from 'zustand';
import type { BleLinkInfo } from '@/shared/transports/ble/BleTransport';
import type { ConnectStage } from '../api/diagnoseFailure';

export interface AttemptDevice {
  id: string | null;
  name: string | null;
}

interface LinkState {
  /** The negotiated BLE link, or null for the simulator / before the link is up. */
  link: BleLinkInfo | null;
  /** The furthest stage the latest connect attempt reached. */
  stage: ConnectStage | null;
  /** Start of the latest connect attempt (ms), or null before the first. */
  attemptStartedAt: number | null;
  /** The device the latest attempt targeted, or null when none was picked. */
  device: AttemptDevice | null;
  /** Start a new attempt: forget the previous link, record the first stage and the target device. */
  beginAttempt: (stage: ConnectStage, device: AttemptDevice | null, now?: number) => void;
  setStage: (stage: ConnectStage) => void;
  setLink: (link: BleLinkInfo | null) => void;
}

export const useLinkStore = create<LinkState>((set) => ({
  link: null,
  stage: null,
  attemptStartedAt: null,
  device: null,
  beginAttempt: (stage, device, now = Date.now()) =>
    set({ link: null, stage, device, attemptStartedAt: now }),
  setStage: (stage) => set({ stage }),
  setLink: (link) => set({ link }),
}));
