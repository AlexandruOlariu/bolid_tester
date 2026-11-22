/** The AI diagnose route (`src/app/ai-diagnose.tsx`) composes the agent contributions of the
 *  features (plan 34a): features never import each other, so the app layer hands the list to the
 *  screen. Lives under test/ because expo-router would treat a `*.test.tsx` inside src/app as a
 *  route. */
import {
  CORE_AGENT_CONTRIBUTION,
  DRIVER_INSTRUCTIONS,
  buildAgentRegistry,
  parseSkillFile,
} from '@/shared/obd-core';
import { AGENT_CONTRIBUTIONS } from '@/app/ai-diagnose';

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
});
