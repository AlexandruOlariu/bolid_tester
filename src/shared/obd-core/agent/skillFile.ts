/** The agent skill file format `bolid.skill.v1` (plan 34a): a declarative document that tells the
 *  model which tools to use for a capability or symptom and how to read the results. Skill files
 *  are bundled as JSON (`*.skill.json`, statically imported) and pass through `parseSkillFile`
 *  when a contribution is built. Model-facing text stays English. See docs/features/ai-diagnose.md. */

import type { Fuel } from '../../vehicles/types';
import type { DriverInstructionId } from './types';

export const SKILL_FORMAT = 'bolid.skill.v1';

/** Profile data a skill can require to be present (non-empty) on the connected car's profile. */
export type SkillProfileFeature =
  | 'extendedPids'
  | 'modules'
  | 'mode06Tests'
  | 'adaptations'
  | 'codingModules'
  | 'boost';

/** Every clause must hold for the skill to be offered. */
export interface SkillRequires {
  pids?: string[];
  anyPids?: string[];
  fuel?: Fuel[];
  protocol?: 'can' | 'kline';
  profile?: SkillProfileFeature[];
  /** capability skills that must be registered and available */
  skills?: string[];
}

export interface SkillFile {
  format: typeof SKILL_FORMAT;
  name: string;
  kind: 'capability' | 'playbook';
  description: string;
  tools: string[];
  driverSteps?: DriverInstructionId[];
  maxAdapterMs?: number;
  requires?: SkillRequires;
  instructions: string[];
  interpret: string[];
  profileNotes?: Record<string, string[]>;
  procedure?: string;
}

const NAME_RE = /^[a-z][a-z0-9_]{1,40}$/;
/** Shape of a driver instruction id; the list itself is `DRIVER_INSTRUCTIONS` (driver.ts). */
const INSTRUCTION_ID_RE = /^[a-z][a-z0-9_]*$/;
const PID_RE = /^[0-9A-F]{4}$/;
const MAX_DESCRIPTION = 160;
/** The adapter polling cap of one run: a skill that needs more could never run. */
const MAX_ADAPTER_MS = 120_000;

const SKILL_KEYS: readonly (keyof SkillFile)[] = [
  'format',
  'name',
  'kind',
  'description',
  'tools',
  'driverSteps',
  'maxAdapterMs',
  'requires',
  'instructions',
  'interpret',
  'profileNotes',
  'procedure',
];
const REQUIRES_KEYS: readonly (keyof SkillRequires)[] = [
  'pids',
  'anyPids',
  'fuel',
  'protocol',
  'profile',
  'skills',
];
const FUELS: readonly Fuel[] = ['diesel', 'petrol', 'lpg', 'hybrid', 'other'];
const PROFILE_FEATURES: readonly SkillProfileFeature[] = [
  'extendedPids',
  'modules',
  'mode06Tests',
  'adaptations',
  'codingModules',
  'boost',
];

class SkillFileError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  known: readonly string[],
  prefix: string,
): void {
  const unknown = Object.keys(obj).find((k) => !known.includes(k));
  if (unknown !== undefined) throw new SkillFileError(`unknown key ${prefix}${unknown}`);
}

/** A copy of a list whose every entry is a string passing `ok`; `nonEmpty` also refuses `[]`. */
function list<T extends string>(
  v: unknown,
  ok: (s: string) => boolean,
  error: string,
  nonEmpty = false,
): T[] {
  if (!Array.isArray(v) || (nonEmpty && v.length === 0)) throw new SkillFileError(error);
  if (!v.every((s) => typeof s === 'string' && ok(s))) throw new SkillFileError(error);
  return [...v] as T[];
}

const nonBlank = (s: string): boolean => s.trim().length > 0;

function parseRequires(raw: unknown): SkillRequires {
  if (!isRecord(raw)) throw new SkillFileError('requires must be an object');
  rejectUnknownKeys(raw, REQUIRES_KEYS, 'requires.');
  const req: SkillRequires = {};
  if (raw.pids !== undefined)
    req.pids = list(raw.pids, (s) => PID_RE.test(s), 'requires.pids must be a list of PIDs');
  if (raw.anyPids !== undefined)
    req.anyPids = list(
      raw.anyPids,
      (s) => PID_RE.test(s),
      'requires.anyPids must be a non-empty list of PIDs',
      true,
    );
  if (raw.fuel !== undefined)
    req.fuel = list<Fuel>(
      raw.fuel,
      (s) => (FUELS as readonly string[]).includes(s),
      'requires.fuel must be a list of fuels',
    );
  if (raw.protocol !== undefined) {
    if (raw.protocol !== 'can' && raw.protocol !== 'kline')
      throw new SkillFileError('requires.protocol must be can or kline');
    req.protocol = raw.protocol;
  }
  if (raw.profile !== undefined)
    req.profile = list<SkillProfileFeature>(
      raw.profile,
      (s) => (PROFILE_FEATURES as readonly string[]).includes(s),
      'requires.profile must be a list of profile features',
    );
  if (raw.skills !== undefined)
    req.skills = list(
      raw.skills,
      (s) => NAME_RE.test(s),
      'requires.skills must be a list of skill names',
    );
  return req;
}

function parseProfileNotes(raw: unknown): Record<string, string[]> {
  const error = 'profileNotes must map profile ids to lists of strings';
  if (!isRecord(raw)) throw new SkillFileError(error);
  const notes: Record<string, string[]> = {};
  for (const [id, lines] of Object.entries(raw)) notes[id] = list(lines, nonBlank, error, true);
  return notes;
}

function parse(raw: unknown): SkillFile {
  if (!isRecord(raw)) throw new SkillFileError('skill must be an object');
  rejectUnknownKeys(raw, SKILL_KEYS, '');
  if (raw.format !== SKILL_FORMAT) throw new SkillFileError(`format must be ${SKILL_FORMAT}`);
  if (typeof raw.name !== 'string' || !NAME_RE.test(raw.name))
    throw new SkillFileError(`name must match ${NAME_RE.source}`);
  if (raw.kind !== 'capability' && raw.kind !== 'playbook')
    throw new SkillFileError('kind must be capability or playbook');
  if (typeof raw.description !== 'string' || !raw.description.startsWith('Use when'))
    throw new SkillFileError('description must start with "Use when"');
  if (raw.description.length > MAX_DESCRIPTION)
    throw new SkillFileError(`description must be at most ${MAX_DESCRIPTION} characters`);

  const skill: SkillFile = {
    format: SKILL_FORMAT,
    name: raw.name,
    kind: raw.kind,
    description: raw.description,
    tools: list(raw.tools, nonBlank, 'tools must be a list of strings'),
    instructions: [],
    interpret: [],
  };
  if (raw.driverSteps !== undefined)
    skill.driverSteps = list<DriverInstructionId>(
      raw.driverSteps,
      (s) => INSTRUCTION_ID_RE.test(s),
      'driverSteps must be a list of instruction ids',
    );
  if (raw.maxAdapterMs !== undefined) {
    const ms = raw.maxAdapterMs;
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 1 || ms > MAX_ADAPTER_MS)
      throw new SkillFileError(`maxAdapterMs must be an integer from 1 to ${MAX_ADAPTER_MS}`);
    skill.maxAdapterMs = ms;
  }
  if (raw.requires !== undefined) skill.requires = parseRequires(raw.requires);
  skill.instructions = list(
    raw.instructions,
    nonBlank,
    'instructions must be a non-empty list of strings',
    true,
  );
  skill.interpret = list(
    raw.interpret,
    nonBlank,
    'interpret must be a non-empty list of strings',
    true,
  );
  if (raw.profileNotes !== undefined) skill.profileNotes = parseProfileNotes(raw.profileNotes);
  if (raw.procedure !== undefined) {
    if (typeof raw.procedure !== 'string' || !nonBlank(raw.procedure))
      throw new SkillFileError('procedure must be a non-empty string');
    skill.procedure = raw.procedure;
  }
  return skill;
}

/** Validates a raw (JSON) skill file. Returns a fresh `SkillFile`, or the first problem found. */
export function parseSkillFile(
  raw: unknown,
): { ok: true; skill: SkillFile } | { ok: false; error: string } {
  try {
    return { ok: true, skill: parse(raw) };
  } catch (e) {
    if (e instanceof SkillFileError) return { ok: false, error: e.message };
    throw e;
  }
}

/** `parseSkillFile` for a bundled skill file (`name` is the file's skill name, for the message): the
 *  parsed skill, or a throw — a broken bundled skill is a programming error the contribution tests
 *  catch. */
export function parseSkillFileOrThrow(raw: unknown, name: string): SkillFile {
  const parsed = parseSkillFile(raw);
  if (!parsed.ok) throw new Error(`Invalid skill file ${name}: ${parsed.error}`);
  return parsed.skill;
}

/** The skill as the model reads it after `open_skill`: steps, how to interpret, this car's notes
 *  (keyed by the fault-guide profile id) and, when it has one, how to run its procedure. */
export function renderSkillForModel(skill: SkillFile, guideProfileId: string): string {
  const lines = [
    `# ${skill.name}`,
    skill.description,
    `Tools: ${skill.tools.join(', ')}`,
    'Steps:',
    ...skill.instructions.map((s, i) => `${i + 1}. ${s}`),
    'Interpret:',
    ...skill.interpret.map((s) => `- ${s}`),
  ];
  const notes = skill.profileNotes?.[guideProfileId];
  if (notes && notes.length > 0) lines.push('Notes for this car:', ...notes.map((n) => `- ${n}`));
  if (skill.procedure)
    lines.push(
      `Procedure: call run_skill with ${JSON.stringify({ name: skill.name })} to run all of it in one step.`,
    );
  return lines.join('\n');
}
