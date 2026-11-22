import { golfPlus2009 } from '../../vehicles/golf-plus-2009-20tdi';
import {
  BUILTIN_TOOLS,
  availableSkills,
  availableTools,
  buildAgentRegistry,
  skillIndex,
} from './registry';
import type { SkillFile } from './skillFile';
import type { AgentTool, AvailabilityContext, SkillProcedure } from './types';

const ok: SkillFile = {
  format: 'bolid.skill.v1',
  name: 'battery',
  kind: 'capability',
  description: 'Use when the car is slow to crank or the battery light came on.',
  tools: ['run_skill', 'ask_driver'],
  driverSteps: ['restart_engine'],
  instructions: ['Call run_skill.'],
  interpret: ['12.6 V resting is full.'],
  procedure: 'battery_capture',
};

function fakeTool(name: string, over: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    description: `Fake ${name}.`,
    labelKey: `aiDiagnose:agent.tool.${name}`,
    args: { type: 'object', properties: {} },
    costMs: 1000,
    available: () => true,
    run: async () => ({ digest: name, summary: name }),
    ...over,
  };
}

function fakeProcedure(id: string): SkillProcedure {
  return { id, costMs: 1000, run: async () => ({ digest: id, summary: id }) };
}

const golfCtx: AvailabilityContext = {
  profile: golfPlus2009,
  protocol: golfPlus2009.expectedProtocol,
  supportedPids: golfPlus2009.supportedPids,
  canMonitor: false,
};

/** A skill with only built-in tools and no procedure, gated by `requires`. */
function gated(name: string, over: Partial<SkillFile> = {}): SkillFile {
  return { ...ok, name, procedure: undefined, ...over };
}

it('lists the built-in tools', () =>
  expect(BUILTIN_TOOLS).toEqual(['open_skill', 'run_skill', 'ask_driver']));

it('registry rejects duplicates and dangling names', () => {
  expect(() =>
    buildAgentRegistry([{ tools: [fakeTool('a')] }, { tools: [fakeTool('a')] }]),
  ).toThrow('Duplicate agent tool "a"');
  expect(() => buildAgentRegistry([{ skills: [{ ...ok, tools: ['nope'] }] }])).toThrow(
    'Skill "battery" names unknown tool "nope"',
  );
  expect(() => buildAgentRegistry([{ skills: [{ ...ok, procedure: 'nope' }] }])).toThrow(
    'Skill "battery" names unknown procedure "nope"',
  );
});

it('rejects duplicate skills and procedures and tools named like a built-in', () => {
  expect(() => buildAgentRegistry([{ skills: [gated('x')] }, { skills: [gated('x')] }])).toThrow(
    'Duplicate skill "x"',
  );
  expect(() =>
    buildAgentRegistry([
      { procedures: [fakeProcedure('p')] },
      { procedures: [fakeProcedure('p')] },
    ]),
  ).toThrow('Duplicate procedure "p"');
  expect(() => buildAgentRegistry([{ tools: [fakeTool('run_skill')] }])).toThrow(
    'Duplicate agent tool "run_skill"',
  );
});

it('resolves names across contributions, keeping registration order', () => {
  const reg = buildAgentRegistry([
    {
      tools: [fakeTool('read_live'), fakeTool('read_dtcs')],
      procedures: [fakeProcedure('battery_capture')],
    },
    { skills: [{ ...ok, tools: ['read_live', 'run_skill'] }] },
  ]);
  expect([...reg.tools.keys()]).toEqual(['read_live', 'read_dtcs']);
  expect([...reg.skills.keys()]).toEqual(['battery']);
  expect([...reg.procedures.keys()]).toEqual(['battery_capture']);
});

it('offers only the available tools', () => {
  const reg = buildAgentRegistry([
    { tools: [fakeTool('a'), fakeTool('b', { available: () => false }), fakeTool('c')] },
  ]);
  expect(availableTools(reg, golfCtx).map((t) => t.name)).toEqual(['a', 'c']);
});

it('a skill is offered only when its requires and tools hold', () => {
  const reg = buildAgentRegistry([
    {
      tools: [fakeTool('t', { available: () => false })],
      skills: [
        { ...ok, name: 'trims', tools: ['t'], procedure: undefined },
        { ...ok, name: 'needs_trims', procedure: undefined, requires: { pids: ['0106', '0107'] } },
      ],
    },
  ]);
  expect(availableSkills(reg, golfCtx).map((s) => s.name)).toEqual([]); // Golf has no 0106/0107; t unavailable
});

it('checks each requires clause against the connected car', () => {
  const reg = buildAgentRegistry([
    {
      skills: [
        gated('all_pids', { requires: { pids: ['010C', '0142'] } }),
        gated('missing_pid', { requires: { pids: ['010C', '0106'] } }),
        gated('any_pid', { requires: { anyPids: ['0106', '0142'] } }),
        gated('no_any_pid', { requires: { anyPids: ['0106', '0107'] } }),
        gated('diesel', { requires: { fuel: ['diesel'] } }),
        gated('petrol', { requires: { fuel: ['petrol', 'lpg'] } }),
        gated('can', { requires: { protocol: 'can' } }),
        gated('kline', { requires: { protocol: 'kline' } }),
        gated('ext', { requires: { profile: ['extendedPids', 'modules'] } }),
        gated('boost', { requires: { profile: ['boost'] } }),
        gated('nothing'),
      ],
    },
  ]);
  expect(availableSkills(reg, golfCtx).map((s) => s.name)).toEqual([
    'all_pids',
    'any_pid',
    'diesel',
    'can',
    'ext',
    'nothing',
  ]);
});

it('uses the detected protocol and PIDs, not the profile hints', () => {
  const reg = buildAgentRegistry([
    {
      skills: [
        gated('kline', { requires: { protocol: 'kline' } }),
        gated('trims', { requires: { pids: ['0106'] } }),
      ],
    },
  ]);
  const ctx: AvailabilityContext = {
    ...golfCtx,
    protocol: 'ISO_14230_4_KWP_FAST',
    supportedPids: ['0106'],
  };
  expect(availableSkills(reg, ctx).map((s) => s.name)).toEqual(['kline', 'trims']);
});

it('treats an empty profile list as missing', () => {
  const reg = buildAgentRegistry([
    { skills: [gated('ext', { requires: { profile: ['mode06Tests'] } })] },
  ]);
  const ctx: AvailabilityContext = { ...golfCtx, profile: { ...golfPlus2009, mode06Tests: [] } };
  expect(availableSkills(reg, ctx)).toEqual([]);
});

it('a required skill must be a registered, available capability', () => {
  const reg = buildAgentRegistry([
    {
      tools: [fakeTool('off', { available: () => false })],
      skills: [
        gated('cap'),
        gated('cap_off', { tools: ['off'] }),
        gated('play', { kind: 'playbook' }),
        gated('needs_cap', { kind: 'playbook', requires: { skills: ['cap'] } }),
        gated('needs_cap_off', { kind: 'playbook', requires: { skills: ['cap_off'] } }),
        gated('needs_play', { kind: 'playbook', requires: { skills: ['play'] } }),
        gated('needs_ghost', { kind: 'playbook', requires: { skills: ['ghost'] } }),
      ],
    },
  ]);
  expect(availableSkills(reg, golfCtx).map((s) => s.name)).toEqual(['cap', 'play', 'needs_cap']);
});

it('does not loop on capabilities that require each other', () => {
  const reg = buildAgentRegistry([
    {
      skills: [
        gated('ping', { requires: { skills: ['pong'] } }),
        gated('pong', { requires: { skills: ['ping'] } }),
      ],
    },
  ]);
  expect(availableSkills(reg, golfCtx)).toEqual([]);
});

it('indexes skills one line each', () =>
  expect(skillIndex([ok, gated('dpf', { description: 'Use when the DPF light is on.' })])).toBe(
    '- battery: Use when the car is slow to crank or the battery light came on.\n' +
      '- dpf: Use when the DPF light is on.',
  ));
