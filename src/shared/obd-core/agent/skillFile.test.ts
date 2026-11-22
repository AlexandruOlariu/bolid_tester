import { parseSkillFile, parseSkillFileOrThrow, renderSkillForModel } from './skillFile';
import type { SkillFile } from './skillFile';

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

it('accepts a valid skill', () => expect(parseSkillFile(ok)).toEqual({ ok: true, skill: ok }));

it('accepts every optional field', () => {
  const full: SkillFile = {
    ...ok,
    kind: 'playbook',
    maxAdapterMs: 30_000,
    requires: {
      pids: ['0142'],
      anyPids: ['0106', '0107'],
      fuel: ['diesel'],
      protocol: 'can',
      profile: ['extendedPids'],
      skills: ['battery'],
    },
    profileNotes: { 'golf-plus-2009-20tdi': ['Glow plugs pull 60 A.'] },
  };
  expect(parseSkillFile(full)).toEqual({ ok: true, skill: full });
});

it('returns a copy, not the input object', () => {
  const r = parseSkillFile(ok);
  expect(r.ok && r.skill).not.toBe(ok);
});

it.each([
  [{ ...ok, format: 'bolid.skill.v2' }, 'format must be bolid.skill.v1'],
  [{ ...ok, name: 'Battery' }, 'name must match ^[a-z][a-z0-9_]{1,40}$'],
  [{ ...ok, description: 'Checks the battery.' }, 'description must start with "Use when"'],
  [{ ...ok, instructions: [] }, 'instructions must be a non-empty list of strings'],
  [{ ...ok, extra: 1 }, 'unknown key extra'],
])('rejects %j', (raw, error) => expect(parseSkillFile(raw)).toEqual({ ok: false, error }));

it.each([
  [null, 'skill must be an object'],
  [[ok], 'skill must be an object'],
  [{ ...ok, name: 'b' }, 'name must match ^[a-z][a-z0-9_]{1,40}$'],
  [{ ...ok, name: `b${'a'.repeat(41)}` }, 'name must match ^[a-z][a-z0-9_]{1,40}$'],
  [{ ...ok, kind: 'recipe' }, 'kind must be capability or playbook'],
  [
    { ...ok, description: `Use when ${'x'.repeat(152)}` },
    'description must be at most 160 characters',
  ],
  [{ ...ok, tools: 'run_skill' }, 'tools must be a list of strings'],
  [{ ...ok, tools: [1] }, 'tools must be a list of strings'],
  [{ ...ok, driverSteps: ['Restart engine'] }, 'driverSteps must be a list of instruction ids'],
  [{ ...ok, maxAdapterMs: 0 }, 'maxAdapterMs must be an integer from 1 to 120000'],
  [{ ...ok, maxAdapterMs: 120_001 }, 'maxAdapterMs must be an integer from 1 to 120000'],
  [{ ...ok, requires: [] }, 'requires must be an object'],
  [{ ...ok, requires: { pid: ['010C'] } }, 'unknown key requires.pid'],
  [{ ...ok, requires: { pids: ['10C'] } }, 'requires.pids must be a list of PIDs'],
  [{ ...ok, requires: { anyPids: [] } }, 'requires.anyPids must be a non-empty list of PIDs'],
  [{ ...ok, requires: { fuel: ['steam'] } }, 'requires.fuel must be a list of fuels'],
  [{ ...ok, requires: { protocol: 'j1850' } }, 'requires.protocol must be can or kline'],
  [
    { ...ok, requires: { profile: ['turbo'] } },
    'requires.profile must be a list of profile features',
  ],
  [{ ...ok, requires: { skills: ['Battery'] } }, 'requires.skills must be a list of skill names'],
  [{ ...ok, interpret: [''] }, 'interpret must be a non-empty list of strings'],
  [{ ...ok, profileNotes: { golf: 'x' } }, 'profileNotes must map profile ids to lists of strings'],
  [{ ...ok, procedure: '' }, 'procedure must be a non-empty string'],
])('rejects %j', (raw, error) => expect(parseSkillFile(raw)).toEqual({ ok: false, error }));

it('renders the whole skill in order', () =>
  expect(renderSkillForModel(ok, 'golf-plus-2009-20tdi')).toBe(
    [
      '# battery',
      'Use when the car is slow to crank or the battery light came on.',
      'Tools: run_skill, ask_driver',
      'Steps:',
      '1. Call run_skill.',
      'Interpret:',
      '- 12.6 V resting is full.',
      'Procedure: call run_skill with {"name":"battery"} to run all of it in one step.',
    ].join('\n'),
  ));

it('renders profile notes and the procedure line', () => {
  const s = renderSkillForModel(
    { ...ok, profileNotes: { 'golf-plus-2009-20tdi': ['Glow plugs pull 60 A.'] } },
    'golf-plus-2009-20tdi',
  );
  expect(s).toContain('Notes for this car:\n- Glow plugs pull 60 A.');
  expect(s).toContain('call run_skill with {"name":"battery"}');
});

it('leaves out notes for other cars and the procedure line without a procedure', () => {
  const s = renderSkillForModel(
    {
      ...ok,
      procedure: undefined,
      instructions: ['Read 0142.', 'Compare with the resting voltage.'],
      profileNotes: { 'passat-b55-19tdi': ['Battery in the boot.'] },
    },
    'golf-plus-2009-20tdi',
  );
  expect(s).toContain('Steps:\n1. Read 0142.\n2. Compare with the resting voltage.');
  expect(s).not.toContain('Notes for this car');
  expect(s).not.toContain('Procedure:');
});

it('parseSkillFileOrThrow returns the parsed skill, or throws naming the file and the problem', () => {
  expect(parseSkillFileOrThrow(ok, 'battery')).toEqual(ok);
  expect(() => parseSkillFileOrThrow({ ...ok, kind: 'other' }, 'battery')).toThrow(
    'Invalid skill file battery: kind must be capability or playbook',
  );
});
