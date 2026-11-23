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
import { PLAYBOOK_CONTRIBUTION, type AgentContribution } from '@/shared/obd-core';

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

export default function AiDiagnoseRoute() {
  return <AiDiagnoseScreen contributions={AGENT_CONTRIBUTIONS} />;
}
