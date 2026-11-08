/** Pure model of the three-step first-run card on the Connect tab (plan 01): pick a car → connect →
 *  read faults. The UI (`FirstRunCard`) feeds it live store values; keeping the rules here makes them
 *  unit-testable without React. See docs/features/onboarding.md. */
import type { ConnState } from '@/shared/state/sessionStore';

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
      title: 'Pick your car',
      hint: 'Choose your model on the Vehicle tab, or keep Auto / Generic for any OBD2 car.',
      done: i.selectedProfileId !== 'generic' || i.genericAccepted,
      route: '/vehicle',
    },
    {
      id: 'connect',
      title: 'Connect the adapter',
      hint: 'Plug the adapter into the OBD2 port, switch the ignition on, then scan below.',
      done: i.connectionStatus === 'connected',
      route: '/',
    },
    {
      id: 'faults',
      title: 'Read fault codes',
      hint: 'Open the Faults tab to read stored, pending and permanent trouble codes.',
      done: i.dtcLastReadAt !== null,
      route: '/faults',
    },
  ];
}

export function firstRunComplete(i: FirstRunInput): boolean {
  return firstRunSteps(i).every((s) => s.done);
}
