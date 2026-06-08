/** Cross-cutting connection lifecycle + the active DiagnosticSession. */
import { create } from 'zustand';
import { DiagnosticSession, SessionInfo } from '../obd-core/session/DiagnosticSession';
import { TransportStatus } from '../obd-core/transport/Transport';

export type ConnState = TransportStatus | 'initializing';

interface SessionState {
  status: ConnState;
  deviceId: string | null;
  deviceName: string | null;
  info: SessionInfo | null;
  error: string | null;
  session: DiagnosticSession | null;
  setStatus: (s: ConnState) => void;
  setError: (e: string | null) => void;
  setConnected: (
    session: DiagnosticSession,
    info: SessionInfo,
    device: { id: string | null; name: string | null },
  ) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'disconnected',
  deviceId: null,
  deviceName: null,
  info: null,
  error: null,
  session: null,
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setConnected: (session, info, device) =>
    set({
      session,
      info,
      status: 'connected',
      deviceId: device.id,
      deviceName: device.name,
      error: null,
    }),
  reset: () =>
    set({
      status: 'disconnected',
      session: null,
      info: null,
      deviceId: null,
      deviceName: null,
      error: null,
    }),
}));
