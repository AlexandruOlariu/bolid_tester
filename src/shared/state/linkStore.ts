/** Live facts about the current / latest connect attempt, for the Connect screen's diagnostics
 *  panel: the kind of link (Bluetooth LE, Wi-Fi — plan 26 — or Classic Bluetooth — plan 27), what
 *  the BLE link negotiated (MTU, characteristics, write mode), the furthest stage the attempt
 *  reached, the device it targeted (sessionStore only learns the device on success), and when it
 *  started (so the panel only shows this attempt's adapter-log lines).
 *  Written by connectionService; in-memory only. Lives in shared/state (moved from
 *  features/connection in plan 29) so the adapter-health report can read the link kind and the
 *  negotiated MTU without a feature → feature import. See docs/features/connection.md. */
import { create } from 'zustand';
import type { BleLinkInfo } from '@/shared/transports/common/gatt';

/** Where a connect attempt failed: the phone's radio, the link (BLE or Wi-Fi), the adapter's own
 *  init, the first request to the car (`0100`), or reading the car's details afterwards. */
export type ConnectStage = 'bluetooth' | 'transport' | 'init' | 'probe' | 'identify';

/** The kind of real-adapter link an attempt uses; null for the simulator. */
export type LinkKind = 'ble' | 'wifi' | 'spp';

export interface AttemptDevice {
  id: string | null;
  name: string | null;
}

interface LinkState {
  /** Bluetooth LE, Wi-Fi or Classic Bluetooth for the latest attempt, or null for the simulator /
   *  before the first. */
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
