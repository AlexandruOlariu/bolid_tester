/** The battery-health feature's contribution to the AI diagnostic agent (plan 34a): the `battery`
 *  capability skill, run in one step through `run_skill` by the core `battery_capture` procedure
 *  (resting voltage, cranking dip on a driver restart, charging voltage, verdict). Composed by the
 *  app layer (`src/app/ai-diagnose.tsx`). See docs/features/ai-diagnose.md. */

import { parseSkillFileOrThrow } from '@/shared/obd-core';
import type { AgentContribution } from '@/shared/obd-core';
import batterySkill from './battery.skill.json';

export const agentTools: AgentContribution = {
  skills: [parseSkillFileOrThrow(batterySkill, 'battery')],
};
