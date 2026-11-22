import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { logError } from '@/shared/state/errorLogStore';

/** True while the OS "Reduce motion" / "Remove animations" setting is on (plan 20). Starts false,
 *  reads the setting once and follows changes. Animations that are only decoration (the splash
 *  pulse, press-scale) are skipped when it is on; fades stay, shortened. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        // Starts false: only an enabled setting needs a state change.
        if (alive && on) setReduced(true);
      })
      .catch((e: unknown) =>
        logError({ source: 'a11y/reduce-motion', error: e, severity: 'warning' }),
      );
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => setReduced(on));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}
