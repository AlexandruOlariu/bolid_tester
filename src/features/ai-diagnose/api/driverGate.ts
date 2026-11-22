/** The driver gate of an AI diagnostic agent run (plan 34a): the run's `askDriver` waits here for
 *  the screen's driver prompt (Done / Can't / a choice). One ask is open at a time; a new ask, or
 *  `cancel()` (Stop, the run's end), settles the open one as "Can't" so nothing waits on a prompt
 *  that is gone. The stationary check and the 3 min timeout live in the agent loop. See
 *  docs/features/ai-diagnose.md. */

import type { DriverInstructionId, DriverReply } from '@/shared/obd-core';

export interface DriverGate {
  /** Opens the prompt for `id`; resolves with the driver's reply. */
  ask(id: DriverInstructionId): Promise<DriverReply>;
  /** The driver's reply to the open prompt; ignored when none is open. */
  answer(reply: DriverReply): void;
  /** Settles the open prompt as "Can't". */
  cancel(): void;
  /** The instruction the open prompt shows, or null. */
  pending(): DriverInstructionId | null;
}

export function createDriverGate(): DriverGate {
  let open: { id: DriverInstructionId; resolve: (reply: DriverReply) => void } | null = null;

  const answer = (reply: DriverReply): void => {
    const current = open;
    open = null;
    current?.resolve(reply);
  };

  return {
    ask(id) {
      answer({ kind: 'cant' });
      return new Promise<DriverReply>((resolve) => {
        open = { id, resolve };
      });
    },
    answer,
    cancel: () => answer({ kind: 'cant' }),
    pending: () => open?.id ?? null,
  };
}
