import React from 'react';
import { AiDiagnoseScreen } from '@/features/ai-diagnose';
import { faultCodesAgentTools } from '@/features/fault-codes';
import { liveDataAgentTools } from '@/features/live-data';
import { batteryHealthAgentTools } from '@/features/battery-health';
import { moduleScanAgentTools } from '@/features/module-scan';
import type { AgentContribution } from '@/shared/obd-core';

/** What each feature contributes to the AI diagnostic agent (plan 34a). Features never import each
 *  other, so the app layer composes the list; 34b and 34c append to it. */
export const AGENT_CONTRIBUTIONS: AgentContribution[] = [
  faultCodesAgentTools,
  liveDataAgentTools,
  batteryHealthAgentTools,
  moduleScanAgentTools,
];

export default function AiDiagnoseRoute() {
  return <AiDiagnoseScreen contributions={AGENT_CONTRIBUTIONS} />;
}
