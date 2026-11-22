/** The live-data feature's contribution to the AI diagnostic agent (plan 34a): the `live_data`
 *  capability skill, which teaches the model the core `read_live` tool (one read or a short sampled
 *  window of any supported Mode 01 PID). Composed by the app layer (`src/app/ai-diagnose.tsx`).
 *  See docs/features/ai-diagnose.md. */

import { parseSkillFileOrThrow } from '@/shared/obd-core';
import type { AgentContribution } from '@/shared/obd-core';
import liveDataSkill from './live_data.skill.json';

export const agentTools: AgentContribution = {
  skills: [parseSkillFileOrThrow(liveDataSkill, 'live_data')],
};
