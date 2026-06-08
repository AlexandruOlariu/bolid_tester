import { useCallback, useEffect } from 'react';
import { useDtcStore } from '../model/dtcStore';
import * as dtcService from '../api/dtcService';

export function useDtcs() {
  const { stored, pending, permanent, loading, error, set, setLoading, setError } = useDtcStore();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      set(await dtcService.readAll());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [set, setLoading, setError]);

  const clear = useCallback(async () => {
    const ok = await dtcService.clearAll();
    if (ok) await refresh();
    return ok;
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { stored, pending, permanent, loading, error, refresh, clear };
}
