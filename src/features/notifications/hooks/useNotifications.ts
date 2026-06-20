import { useEffect, useRef } from 'react';
import { deriveDiagnosticEvents, DiagSnapshot } from '@/shared/obd-core';
import { useSessionStore } from '@/shared/state/sessionStore';
import { notify, setNotifPrefs } from '@/shared/notify';
import { logError } from '@/shared/state/errorLogStore';
import { useNotificationsStore } from '../model/notificationsStore';

/** Watch session/diagnostic state and fire OS notifications on rising edges (MIL, connect, etc.). */
export function useNotifications() {
  const status = useSessionStore((s) => s.status);
  const info = useSessionStore((s) => s.info);
  const prefs = useNotificationsStore((s) => s.prefs);
  const prevRef = useRef<DiagSnapshot | null>(null);

  // Keep the shared notifier in sync with the user's prefs.
  useEffect(() => {
    setNotifPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    try {
      const cur: DiagSnapshot = {
        status: status === 'initializing' ? 'connecting' : status,
        milOn: false,
        dtcCount: 0,
      };
      const events = deriveDiagnosticEvents(prevRef.current, cur);
      prevRef.current = cur;
      for (const e of events) void notify(e);
    } catch (e) {
      logError({ source: 'notifications', error: e, severity: 'warning' });
    }
  }, [status, info]);
}
