import { useEffect, useRef } from 'react';
import { AlertEngine, defaultRules } from '@/shared/obd-core';
import { useLiveDataStore } from '@/features/live-data/model/liveDataStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { notify } from '@/shared/notify';
import { useAlertsStore } from '../model/alertsStore';

/** Evaluate alert rules against each live snapshot; fire OS notifications on new warn/critical. */
export function useAlerts() {
  const engineRef = useRef(new AlertEngine());
  const values = useLiveDataStore((s) => s.values);
  const info = useSessionStore((s) => s.info);
  const rules = useAlertsStore((s) => s.rules);
  const setRules = useAlertsStore((s) => s.setRules);
  const setActive = useAlertsStore((s) => s.setActive);

  // Seed sensible defaults once we know the effective PID set.
  useEffect(() => {
    if (rules.length === 0 && info?.supportedPids?.length) setRules(defaultRules(info.supportedPids));
  }, [info, rules.length, setRules]);

  useEffect(() => {
    const { active, fired } = engineRef.current.evaluate(rules, values);
    setActive(active);
    for (const a of fired) {
      if (a.severity !== 'info')
        void notify({
          category: 'alert',
          severity: a.severity,
          title: a.rule.label ?? a.pid,
          body: `${a.pid} = ${a.value}`,
        });
    }
  }, [values, rules, setActive]);

  return { active: useAlertsStore((s) => s.active) };
}
