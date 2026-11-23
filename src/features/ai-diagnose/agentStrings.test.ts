/** Translation completeness for the AI diagnostic agent (plan 34d): every tool label, driver
 *  instruction and answer choice, end-of-run notice and core finding the agent can show exists in
 *  English and Romanian. The feature contributions are imported by path (a test, not product code:
 *  the app layer composes them in `src/app/ai-diagnose.tsx`). Skill documents, digests, prompts and
 *  the share package stay English and are not checked here; see docs/i18n.md. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { i18n } from '@/shared/i18n';
import {
  CORE_AGENT_CONTRIBUTION,
  DRIVER_INSTRUCTIONS,
  PLAYBOOK_CONTRIBUTION,
  type AgentContribution,
} from '@/shared/obd-core';
import { agentTools as adaptations } from '@/features/adaptations/agent/agentTools';
import { agentTools as adapterHealth } from '@/features/adapter-health/agent/agentTools';
import { agentTools as alerts } from '@/features/alerts/agent/agentTools';
import { agentTools as batteryHealth } from '@/features/battery-health/agent/agentTools';
import { agentTools as canSniffer } from '@/features/can-sniffer/agent/agentTools';
import { agentTools as coding } from '@/features/coding/agent/agentTools';
import { agentTools as dpf } from '@/features/dpf/agent/agentTools';
import { agentTools as errorLog } from '@/features/error-log/agent/agentTools';
import { agentTools as extendedPids } from '@/features/extended-pids/agent/agentTools';
import { agentTools as faultCodes } from '@/features/fault-codes/agent/agentTools';
import { agentTools as history } from '@/features/history/agent/agentTools';
import { agentTools as inspection } from '@/features/inspection/agent/agentTools';
import { agentTools as liveCharts } from '@/features/live-charts/agent/agentTools';
import { agentTools as liveData } from '@/features/live-data/agent/agentTools';
import { agentTools as maintenance } from '@/features/maintenance/agent/agentTools';
import { agentTools as moduleScan } from '@/features/module-scan/agent/agentTools';
import { agentTools as performanceTests } from '@/features/performance-tests/agent/agentTools';
import { agentTools as sensorTests } from '@/features/sensor-tests/agent/agentTools';
import { agentTools as tripRecording } from '@/features/trip-recording/agent/agentTools';
import { agentTools as vehicleInfo } from '@/features/vehicle-info/agent/agentTools';

/** Every `src/features/<slug>/agent/agentTools.ts` contribution. */
const FEATURE_AGENT_TOOLS: AgentContribution[] = [
  adaptations,
  adapterHealth,
  alerts,
  batteryHealth,
  canSniffer,
  coding,
  dpf,
  errorLog,
  extendedPids,
  faultCodes,
  history,
  inspection,
  liveCharts,
  liveData,
  maintenance,
  moduleScan,
  performanceTests,
  sensorTests,
  tripRecording,
  vehicleInfo,
];

const contributions = [CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION, ...FEATURE_AGENT_TOOLS];

const END_NOTICES = [
  'no_ai',
  'no_ai_symptom',
  'steps',
  'time',
  'adapter',
  'invalid',
  'stopped',
  'disconnected',
  'ai_error',
];

/** The findings the core procedures (battery capture, fuel trims, boost, charging, cooling,
 *  misfire) emit. The analysers' `insufficient` / `no_data` outcomes are not here: the procedures
 *  turn them into a "not judged" digest line, never a finding. */
const CORE_FINDING_KEYS = [
  ...['good', 'fair', 'weak', 'unknown'].map((v) => `battery.${v}`),
  ...['weakUnderLoad', 'ok'].map((v) => `charging.${v}`),
  ...['ok', 'lean', 'rich', 'vacuum_leak', 'lean_all_speeds'].map((v) => `trims.${v}`),
  ...[
    'ok',
    'idle_high',
    'stuck_vnt',
    'map_below_baro',
    'no_boost_hold',
    'overboost_hold',
    'stuck_sensor',
    'hold_not_reached',
  ].map((v) => `boost.${v}`),
  ...[
    'ok',
    'hot_now',
    'overheat_now',
    'thermostat_open',
    'slow_warmup',
    'trip_overheat',
    'no_cold_trip',
  ].map((v) => `cooling.${v}`),
  ...['none', 'cylinder', 'random'].map((v) => `misfire.${v}`),
].map((k) => `aiDiagnose:agent.finding.${k}`);

// `lngs: [lng]`, not `lng`: with `lng` alone i18next also looks in `fallbackLng` (en), so a key
// missing from ro would still count as present.
const missing = (keys: string[], lng: string): string[] =>
  keys.filter((k) => !i18n.exists(k, { lngs: [lng] }));

describe('agent strings are translated (plan 34d)', () => {
  it('covers every feature contribution and the core tools', () => {
    expect(FEATURE_AGENT_TOOLS).toHaveLength(20);
    expect(CORE_AGENT_CONTRIBUTION.tools?.length).toBeGreaterThan(0);
  });

  it('a key that exists only in English counts as missing in Romanian (no fallback)', () => {
    // i18n has `fallbackLng: 'en'`, so the check must look in the one language only.
    i18n.addResourceBundle('en', 'agentStringsProbe', { onlyEn: 'x' });
    try {
      const key = 'agentStringsProbe:onlyEn';
      expect(missing([key], 'en')).toEqual([]);
      expect(missing([key], 'ro')).toEqual([key]);
    } finally {
      i18n.removeResourceBundle('en', 'agentStringsProbe');
    }
  });

  it.each(['en', 'ro'])('every tool label exists in %s', (lng) => {
    const labels = contributions.flatMap((c) => (c.tools ?? []).map((t) => t.labelKey));
    expect(labels.length).toBeGreaterThan(20);
    expect(missing(labels, lng)).toEqual([]);
  });

  it.each(['en', 'ro'])('every driver instruction and choice exists in %s', (lng) => {
    const keys: string[] = [];
    for (const [id, d] of Object.entries(DRIVER_INSTRUCTIONS)) {
      expect(id).toMatch(/^[a-z_0-9]+$/);
      expect(d.labelKey).toBe(`aiDiagnose:agent.driver.${id}`);
      keys.push(d.labelKey);
      // DriverPrompt renders each choice from `aiDiagnose:agent.driverChoice.<value>`.
      for (const c of d.choices ?? []) keys.push(`aiDiagnose:agent.driverChoice.${c}`);
    }
    expect(missing(keys, lng)).toEqual([]);
  });

  it.each(['en', 'ro'])('every end notice exists in %s', (lng) => {
    expect(
      missing(
        END_NOTICES.map((e) => `aiDiagnose:agent.end.${e}`),
        lng,
      ),
    ).toEqual([]);
  });

  it.each(['en', 'ro'])('every core finding key has a title and detail in %s', (lng) => {
    const keys = CORE_FINDING_KEYS.flatMap((k) => [`${k}.title`, `${k}.detail`]);
    expect(missing(keys, lng)).toEqual([]);
  });
});
