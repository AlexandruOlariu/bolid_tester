import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import * as connectionService from '../api/connectionService';
import type { ConnectTarget } from '../api/connectionService';

export function useConnect() {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const adapterSource = useSettingsStore((s) => s.adapterSource);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(
    async (target?: ConnectTarget) => {
      setBusy(true);
      try {
        await connectionService.connect(target);
        // A connect superseded by an adapter-source switch resolves without a session; stay put.
        if (useSessionStore.getState().status === 'connected') router.push('/vehicle');
      } catch {
        // error is surfaced via the session store
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  /** Web build (plan 28): open the browser's Bluetooth chooser, then connect to the pick. Wired
   *  straight to the button's press handler — Chrome only opens the chooser from a user gesture. */
  const chooseAndConnect = useCallback(async () => {
    setBusy(true);
    try {
      if (await connectionService.chooseWebAdapterAndConnect()) router.push('/vehicle');
    } catch {
      // error is surfaced via the session store
    } finally {
      setBusy(false);
    }
  }, [router]);

  const disconnect = useCallback(async () => {
    await connectionService.disconnect();
  }, []);

  return { status, error, adapterSource, busy, connect, chooseAndConnect, disconnect };
}
