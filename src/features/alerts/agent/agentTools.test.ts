/** The alerts agent tool (plan 34b): `read_alerts` lists the threshold rules and the alerts active
 *  right now, and says that fired alerts are not stored. The persist storage runs over a no-op file
 *  system. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { buildAgentRegistry, defaultRules, parseSkillFile } from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  AlertRule,
  ReadOnlySession,
  ToolContext,
} from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/alerts.json';
import ro from '@/shared/i18n/locales/ro/alerts.json';
import { useAlertsStore } from '../model/alertsStore';
import { agentTools as alertTools } from './agentTools';
import alertsHistorySkill from './alerts_history.skill.json';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const NOW = new Date(2026, 10, 20, 12, 0).getTime();
const FIRED_LINE = 'Fired alerts are not stored; only the ones active right now are known.';

const golfCtx: ToolContext = {
  session: {} as ReadOnlySession,
  profile: golf,
  guideProfileId: golf.id,
  vehicle: { label: golf.name, make: golf.make },
  vin: null,
  now: () => NOW,
  sleep: async () => undefined,
  signal: new AbortController().signal,
  askDriver: async () => ({ kind: 'done' }),
};

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

beforeEach(() => {
  useAlertsStore.setState({ rules: [], seededIds: [], active: [] });
});

describe('read_alerts', () => {
  it('alerts say fired alerts are not stored', async () =>
    expect((await toolOf(alertTools, 'read_alerts').run({}, golfCtx)).digest).toContain(
      'Fired alerts are not stored',
    ));

  it('with no rules says so and that nothing is active', async () => {
    const r = await toolOf(alertTools, 'read_alerts').run({}, golfCtx);
    expect(r.digest.split('\n')).toEqual(['No alert rules set.', 'Active now: none.', FIRED_LINE]);
    expect(r.summary).toBe('Alerts: 0 rules, 0 active');
  });

  it('lists every rule with its threshold and state, then the active alerts', async () => {
    const [coolant, voltage] = defaultRules(['0105', '0142']);
    const band: AlertRule = {
      id: 'boost',
      pid: '010B',
      op: 'outside',
      value: 90,
      value2: 250,
      severity: 'info',
    };
    useAlertsStore.setState({
      rules: [coolant, { ...voltage, enabled: false }, band],
      active: [
        {
          ruleId: coolant.id,
          pid: '0105',
          severity: 'critical',
          value: 112,
          since: NOW - 90_000,
          rule: coolant,
        },
      ],
    });
    const r = await toolOf(alertTools, 'read_alerts').run({}, golfCtx);
    expect(r.digest.split('\n')).toEqual([
      'Rules (3):',
      'Coolant overheating: 0105 > 110 °C (on)',
      'Low battery voltage: 0142 < 11.8 V (off)',
      '010B: 010B outside 90..250 kPa (on)',
      'Active now (1):',
      'Coolant overheating: 0105 = 112 °C, critical, for 2 min',
      FIRED_LINE,
    ]);
    expect(r.summary).toBe('Alerts: 3 rules, 1 active');
  });
});

describe('alerts contribution', () => {
  it('declares the tool always offered and free of adapter time', () => {
    const t = toolOf(alertTools, 'read_alerts');
    expect(
      t.available({
        profile: getVehicleProfile('passat-b55-19tdi'),
        protocol: 'ISO_14230_4_KWP_FAST',
        supportedPids: [],
        canMonitor: false,
      }),
    ).toBe(true);
    expect(t.costMs).toBe(0);
    expect(t.labelKey).toBe('alerts:agent.tool.read_alerts');
  });

  it('bundles an alerts_history skill that parses and registers', () => {
    expect(parseSkillFile(alertsHistorySkill).ok).toBe(true);
    expect(alertTools.skills?.map((s) => s.name)).toEqual(['alerts_history']);
    expect(alertTools.skills?.[0].tools).toEqual(['read_alerts']);
    expect(() => buildAgentRegistry([alertTools])).not.toThrow();
  });

  it('the tool label has en and ro text', () => {
    for (const locale of [en, ro]) expect(locale.agent.tool.read_alerts).toBeTruthy();
  });
});
