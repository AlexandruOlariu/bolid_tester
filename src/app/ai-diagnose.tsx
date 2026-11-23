import React from 'react';
import { AiDiagnoseScreen } from '@/features/ai-diagnose';
import { faultCodesAgentTools } from '@/features/fault-codes';
import { liveDataAgentTools } from '@/features/live-data';
import { batteryHealthAgentTools } from '@/features/battery-health';
import { moduleScanAgentTools } from '@/features/module-scan';
import { liveChartsAgentTools } from '@/features/live-charts';
import { sensorTestsAgentTools } from '@/features/sensor-tests';
import { extendedPidsAgentTools } from '@/features/extended-pids';
import { dpfAgentTools } from '@/features/dpf';
import { adaptationsAgentTools } from '@/features/adaptations';
import { codingAgentTools } from '@/features/coding';
import { inspectionAgentTools } from '@/features/inspection';
import { vehicleInfoAgentTools } from '@/features/vehicle-info';
import { adapterHealthAgentTools } from '@/features/adapter-health';
import { tripRecordingAgentTools } from '@/features/trip-recording';
import { performanceTestsAgentTools } from '@/features/performance-tests';
import { maintenanceAgentTools } from '@/features/maintenance';
import { historyAgentTools } from '@/features/history';
import { alertsAgentTools } from '@/features/alerts';
import { errorLogAgentTools } from '@/features/error-log';
import { canSnifferAgentTools } from '@/features/can-sniffer';
import { connectionService } from '@/features/connection';
import {
  PLAYBOOK_CONTRIBUTION,
  type AgentContribution,
  type DriverInstructionId,
  type DriverReply,
} from '@/shared/obd-core';

/** What each feature contributes to the AI diagnostic agent (plan 34a). Features never import each
 *  other, so the app layer composes the list; 34b and 34c append to it. The symptom playbooks
 *  (plan 34c) come last: they reach the features' skills and tools by name. */
export const AGENT_CONTRIBUTIONS: AgentContribution[] = [
  faultCodesAgentTools,
  liveDataAgentTools,
  batteryHealthAgentTools,
  moduleScanAgentTools,
  liveChartsAgentTools,
  sensorTestsAgentTools,
  extendedPidsAgentTools,
  dpfAgentTools,
  adaptationsAgentTools,
  codingAgentTools,
  inspectionAgentTools,
  vehicleInfoAgentTools,
  adapterHealthAgentTools,
  tripRecordingAgentTools,
  performanceTestsAgentTools,
  maintenanceAgentTools,
  historyAgentTools,
  alertsAgentTools,
  errorLogAgentTools,
  canSnifferAgentTools,
  PLAYBOOK_CONTRIBUTION,
];

/** How long the simulator holds 2500 rpm once the driver confirms the rev hold (plan 34c). */
export const SIM_REV_HOLD_MS = 15_000;

/** The driver confirmed "hold 2500 rpm": in simulator mode the simulated engine holds it for
 *  `SIM_REV_HOLD_MS` so the boost and fuel-trim procedures see a hold. With a real adapter
 *  `holdRevs` does nothing. */
export function onDriverAnswer(id: DriverInstructionId, reply: DriverReply): void {
  if (id === 'hold_2500_rpm' && reply.kind === 'done') {
    connectionService.__sim.holdRevs(SIM_REV_HOLD_MS);
  }
}

export default function AiDiagnoseRoute() {
  return <AiDiagnoseScreen contributions={AGENT_CONTRIBUTIONS} onDriverAnswer={onDriverAnswer} />;
}
