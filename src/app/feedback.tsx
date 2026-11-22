import React from 'react';
import { FeedbackScreen } from '@/features/feedback';
import { formatAutoScanReport, useScanHistoryStore } from '@/features/module-scan';

/** The newest saved module scan as text, or null. */
function lastScanReport(): string | null {
  const scan = useScanHistoryStore.getState().scans[0];
  return scan ? formatAutoScanReport(scan) : null;
}

/** The route composes **Report a problem** with the module-scan slice's last scan (plan 32):
 *  features never import each other, so the app layer hands the report reader in. */
export default function FeedbackRoute() {
  const hasScan = useScanHistoryStore((s) => s.scans.length > 0);
  return <FeedbackScreen getLastScanReport={lastScanReport} hasScan={hasScan} />;
}
