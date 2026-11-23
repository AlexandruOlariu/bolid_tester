/** The AI diagnose route (`src/app/ai-diagnose.tsx`) composes the agent contributions of the
 *  features (plan 34a): features never import each other, so the app layer hands the list to the
 *  screen. Lives under test/ because expo-router would treat a `*.test.tsx` inside src/app as a
 *  route. */
import {
  CORE_AGENT_CONTRIBUTION,
  DRIVER_INSTRUCTIONS,
  availableSkills,
  buildAgentRegistry,
  parseSkillFile,
  type AvailabilityContext,
} from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import { AGENT_CONTRIBUTIONS, SIM_REV_HOLD_MS, onDriverAnswer } from '@/app/ai-diagnose';
import { connectionService } from '@/features/connection';

/** The 21 capability skills of the spec's catalog (plan 34b): one per app feature the agent reads. */
const CAPABILITY_SKILLS = [
  'fault_codes',
  'module_scan',
  'live_data',
  'record_live',
  'sensor_tests',
  'extended_data',
  'adaptations_read',
  'coding_read',
  'dpf',
  'battery',
  'used_car_check',
  'vehicle_identity',
  'adapter_health',
  'trips',
  'performance_history',
  'fuel_economy',
  'maintenance',
  'history',
  'alerts_history',
  'app_errors',
  'bus_listen',
];

/** A car connected on its expected protocol (CAN 11/500 when the profile says AUTO), with no PID
 *  bitmap read yet: what the agent sees for a profile before any discovery. */
function availability(profileId: string): AvailabilityContext {
  const profile = getVehicleProfile(profileId);
  return {
    profile,
    protocol:
      profile.expectedProtocol === 'AUTO' ? 'ISO_15765_4_CAN_11_500' : profile.expectedProtocol,
    supportedPids: profile.supportedPids,
    canMonitor: false,
  };
}

describe('AI diagnose route', () => {
  it('the route registers the first capability skills without conflicts', () => {
    const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
    expect([...reg.skills.keys()]).toEqual(
      expect.arrayContaining(['fault_codes', 'live_data', 'battery']),
    );
  });

  it('every composed skill parses and asks only for listed driver instructions', () => {
    for (const s of AGENT_CONTRIBUTIONS.flatMap((c) => c.skills ?? [])) {
      expect(parseSkillFile(s).ok).toBe(true);
      for (const id of s.driverSteps ?? []) expect(Object.keys(DRIVER_INSTRUCTIONS)).toContain(id);
    }
  });

  it('the battery skill runs the battery_capture procedure after a restart', () => {
    const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
    expect(reg.skills.get('battery')).toMatchObject({
      kind: 'capability',
      tools: ['run_skill', 'ask_driver'],
      driverSteps: ['restart_engine'],
      procedure: 'battery_capture',
    });
    expect(reg.skills.get('live_data')).toMatchObject({ kind: 'capability', tools: ['read_live'] });
  });

  it('registers all 21 capability skills, each a capability', () => {
    const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
    for (const n of CAPABILITY_SKILLS) expect(reg.skills.get(n)?.kind).toBe('capability');
  });

  it.each([
    ['golf-plus-2009-20tdi', ['module_scan', 'dpf', 'extended_data']],
    ['passat-b55-19tdi', ['adaptations_read']],
    ['fiat-punto-2008-12', ['fault_codes', 'live_data']],
  ])('%s offers %j', (id, names) => {
    const offered = availableSkills(
      buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]),
      availability(id),
    ).map((s) => s.name);
    expect(offered).toEqual(expect.arrayContaining(names));
  });

  it('composes the 17 playbooks after the features, each reaching its capability skill', () => {
    const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
    expect([...reg.skills.values()].filter((s) => s.kind === 'playbook')).toHaveLength(17);
    const offered = (id: string) => availableSkills(reg, availability(id)).map((s) => s.name);
    expect(offered('golf-plus-2009-20tdi')).toEqual(
      expect.arrayContaining([
        'boost',
        'dpf_regen',
        'used_car',
        'keeps_disconnecting',
        'glow_plugs',
      ]),
    );
    expect(offered('fiat-punto-2008-12')).toEqual(
      expect.arrayContaining(['fuel_trims', 'misfire', 'cooling', 'check_engine_light']),
    );
    expect(offered('fiat-punto-2008-12')).not.toContain('dpf_regen');
  });

  it('a confirmed rev hold starts the simulator hold for 15 s; nothing else does (plan 34c)', () => {
    const hold = jest.spyOn(connectionService.__sim, 'holdRevs').mockReturnValue(true);
    try {
      onDriverAnswer('hold_2500_rpm', { kind: 'cant' });
      onDriverAnswer('hold_2500_rpm', { kind: 'timeout' });
      onDriverAnswer('restart_engine', { kind: 'done' });
      expect(hold).not.toHaveBeenCalled();
      onDriverAnswer('hold_2500_rpm', { kind: 'done' });
      expect(SIM_REV_HOLD_MS).toBe(15_000);
      expect(hold).toHaveBeenCalledWith(15_000);
      expect(hold).toHaveBeenCalledTimes(1);
    } finally {
      hold.mockRestore();
    }
  });

  it('no capability tool is a write', () => {
    const reg = buildAgentRegistry([CORE_AGENT_CONTRIBUTION, ...AGENT_CONTRIBUTIONS]);
    for (const name of reg.tools.keys())
      expect(name).not.toMatch(/clear|write|reset|code_module|routine|regen/);
  });
});
