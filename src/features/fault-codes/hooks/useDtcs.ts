import { useCallback, useEffect } from 'react';
import { logError } from '@/shared/state/errorLogStore';
import { useDtcStore } from '../model/dtcStore';
import * as dtcService from '../api/dtcService';

export function useDtcs() {
  const { stored, pending, permanent, readiness, freezeFrame, loading, error, set, setLoading, setError } =
    useDtcStore();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      set(await dtcService.readAll());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      logError({ source: 'fault-codes', error: e });
    } finally {
      setLoading(false);
    }
  }, [set, setLoading, setError]);

  const clear = useCallback(async () => {
    try {
      const ok = await dtcService.clearAll();
      if (!ok) logError({ source: 'fault-codes/clear', error: 'Mode 04 not acknowledged (NO DATA / no response)', severity: 'warning' });
      if (ok) await refresh();
      return ok;
    } catch (e) {
      logError({ source: 'fault-codes/clear', error: e });
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { stored, pending, permanent, readiness, freezeFrame, loading, error, refresh, clear };
}
