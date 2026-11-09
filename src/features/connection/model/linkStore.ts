/** Live facts about the current / latest connect attempt, for the Connect screen's diagnostics
 *  panel: the kind of link (Bluetooth LE or Wi-Fi, plan 26), what the BLE link negotiated (MTU, characteristics, write mode), the furthest stage the
 *  attempt reached, the device it targeted (sessionStore only learns the device on success), and
 *  when it started (so the panel only shows this attempt's adapter-log lines).
 *  Written by connectionService; in-memory only. See docs/features/connection.md. */
import { create } from 'zustand';
import type { BleLinkInfo } from '@/shared/transports/ble/BleTransport';
import type { ConnectStage } from '../api/diagnoseFailure';

/** The kind of real-adapter link an attempt uses; null for the simulator. */
export type LinkKind = 'ble' | 'wifi';

export interface AttemptDevice {
  id: string | null;
  name: string | null;
}

interface LinkState {
  /** Bluetooth LE or Wi-Fi for the latest attempt, or null for the simulator / before the first. */
  kind: LinkKind | null;
  /** The negotiated BLE link, or null for the simulator / before the link is up. */
  link: BleLinkInfo | null;
  /** The furthest stage the latest connect attempt reached. */
  stage: ConnectStage | null;
  /** Start of the latest connect attempt (ms), or null before the first. */
  attemptStartedAt: number | null;
  /** The device the latest attempt targeted, or null when none was picked. */
  device: AttemptDevice | null;
  /** Start a new attempt: forget the previous link, record the first stage, the target device and
   *  the link kind (null for the simulator). */
  beginAttempt: (
    stage: ConnectStage,
    device: AttemptDevice | null,
    kind?: LinkKind | null,
    now?: number,
  ) => void;
  setStage: (stage: ConnectStage) => void;
  setLink: (link: BleLinkInfo | null) => void;
}

export const useLinkStore = create<LinkState>((set) => ({
  kind: null,
  link: null,
  stage: null,
  attemptStartedAt: null,
  device: null,
  beginAttempt: (stage, device, kind = null, now = Date.now()) =>
    set({ kind, link: null, stage, device, attemptStartedAt: now }),
  setStage: (stage) => set({ stage }),
  setLink: (link) => set({ link }),
}));
