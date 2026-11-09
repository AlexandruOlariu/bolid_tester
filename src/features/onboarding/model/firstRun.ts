/** Pure model of the three-step first-run card on the Connect tab (plan 01): pick a car → connect →
 *  read faults. The UI (`FirstRunCard`) feeds it live store values; keeping the rules here makes them
 *  unit-testable without React. See docs/features/onboarding.md. */
import type { ConnState } from '@/shared/state/sessionStore';
import { translate } from '@/shared/i18n';

/** Hint id for the whole first-run card; dismissed manually or automatically once every step is done. */
export const FIRST_RUN_HINT_ID = 'first-run';
/** Hint id recorded when the user explicitly accepts the Auto / Generic profile (counts as "picked"). */
export const FIRST_RUN_GENERIC_OK_ID = 'first-run-generic-ok';

export interface FirstRunInput {
  /** `vehicleStore.selectedProfileId` — `'generic'` until the user picks a car. */
  selectedProfileId: string;
  /** True when the user tapped "Use Auto / Generic" (dismissed id `first-run-generic-ok`). */
  genericAccepted: boolean;
  connectionStatus: ConnState;
  /** `dtcStore.lastReadAt` — null until faults were read once this session. */
  dtcLastReadAt: number | null;
}

export interface FirstRunStep {
  id: 'vehicle' | 'connect' | 'faults';
  title: string;
  hint: string;
  done: boolean;
  route: string;
}

export function firstRunSteps(i: FirstRunInput): FirstRunStep[] {
  return [
    {
      id: 'vehicle',
      title: translate('onboarding:firstRun.vehicle.title'),
      hint: translate('onboarding:firstRun.vehicle.hint'),
      done: i.selectedProfileId !== 'generic' || i.genericAccepted,
      route: '/vehicle',
    },
    {
      id: 'connect',
      title: translate('onboarding:firstRun.connect.title'),
      hint: translate('onboarding:firstRun.connect.hint'),
      done: i.connectionStatus === 'connected',
      route: '/',
    },
    {
      id: 'faults',
      title: translate('onboarding:firstRun.faults.title'),
      hint: translate('onboarding:firstRun.faults.hint'),
      done: i.dtcLastReadAt !== null,
      route: '/faults',
    },
  ];
}

export function firstRunComplete(i: FirstRunInput): boolean {
  return firstRunSteps(i).every((s) => s.done);
}
