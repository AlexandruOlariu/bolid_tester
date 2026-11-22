/** The agent registry (plan 34a): every tool, skill and skill procedure the features contribute,
 *  checked once when the agent screen is composed, and the per-car filters that decide what the
 *  model is offered. The core contribution comes first. See docs/features/ai-diagnose.md. */

import { isCan, isKLine } from '../obd/protocols';
import type { SkillFile, SkillProfileFeature } from './skillFile';
import type { AgentContribution, AgentTool, AvailabilityContext, SkillProcedure } from './types';

export interface AgentRegistry {
  tools: ReadonlyMap<string, AgentTool>;
  skills: ReadonlyMap<string, SkillFile>;
  procedures: ReadonlyMap<string, SkillProcedure>;
}

/** Tools the agent loop itself implements; skills may name them, contributions may not. */
export const BUILTIN_TOOLS = ['open_skill', 'run_skill', 'ask_driver'] as const;

const isBuiltin = (name: string): boolean => (BUILTIN_TOOLS as readonly string[]).includes(name);

/** Merges the contributions (core first). Throws on a duplicate name or a skill naming a tool or
 *  procedure nobody registered — a programming error caught by the contribution tests. */
export function buildAgentRegistry(contributions: AgentContribution[]): AgentRegistry {
  const tools = new Map<string, AgentTool>();
  const skills = new Map<string, SkillFile>();
  const procedures = new Map<string, SkillProcedure>();
  for (const c of contributions) {
    for (const t of c.tools ?? []) {
      if (tools.has(t.name) || isBuiltin(t.name))
        throw new Error(`Duplicate agent tool "${t.name}"`);
      tools.set(t.name, t);
    }
    for (const s of c.skills ?? []) {
      if (skills.has(s.name)) throw new Error(`Duplicate skill "${s.name}"`);
      skills.set(s.name, s);
    }
    for (const p of c.procedures ?? []) {
      if (procedures.has(p.id)) throw new Error(`Duplicate procedure "${p.id}"`);
      procedures.set(p.id, p);
    }
  }
  for (const s of skills.values()) {
    const unknownTool = s.tools.find((t) => !isBuiltin(t) && !tools.has(t));
    if (unknownTool !== undefined)
      throw new Error(`Skill "${s.name}" names unknown tool "${unknownTool}"`);
    if (s.procedure !== undefined && !procedures.has(s.procedure))
      throw new Error(`Skill "${s.name}" names unknown procedure "${s.procedure}"`);
  }
  return { tools, skills, procedures };
}

/** The registered tools the connected car supports, in registration order. */
export function availableTools(reg: AgentRegistry, ctx: AvailabilityContext): AgentTool[] {
  return [...reg.tools.values()].filter((t) => t.available(ctx));
}

/** The registered skills whose `requires` hold and whose tools are all available, in order. */
export function availableSkills(reg: AgentRegistry, ctx: AvailabilityContext): SkillFile[] {
  return [...reg.skills.values()].filter((s) => isSkillAvailable(reg, ctx, s, new Set()));
}

/** One line per skill for the system prompt: `- name: description`. */
export function skillIndex(skills: SkillFile[]): string {
  return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
}

function hasProfileFeature(ctx: AvailabilityContext, feature: SkillProfileFeature): boolean {
  const p = ctx.profile;
  switch (feature) {
    case 'extendedPids':
      return (p.extendedPids?.length ?? 0) > 0;
    case 'modules':
      return (p.modules?.length ?? 0) > 0;
    case 'mode06Tests':
      return (p.mode06Tests?.length ?? 0) > 0;
    case 'adaptations':
      return (p.adaptations?.length ?? 0) > 0;
    case 'codingModules':
      return (p.codingModules?.length ?? 0) > 0;
    case 'boost':
      // Boost data joins VehicleProfile in plan 34c; until then no car has it.
      return false;
  }
}

/** `visiting` holds the skills on the current `requires.skills` path, so a cycle reads as false. */
function isSkillAvailable(
  reg: AgentRegistry,
  ctx: AvailabilityContext,
  skill: SkillFile,
  visiting: Set<string>,
): boolean {
  if (visiting.has(skill.name)) return false;
  const req = skill.requires ?? {};
  const supported = new Set(ctx.supportedPids);
  if (req.pids && !req.pids.every((pid) => supported.has(pid))) return false;
  if (req.anyPids && !req.anyPids.some((pid) => supported.has(pid))) return false;
  if (req.fuel && !req.fuel.includes(ctx.profile.fuel)) return false;
  if (req.protocol === 'can' && !isCan(ctx.protocol)) return false;
  if (req.protocol === 'kline' && !isKLine(ctx.protocol)) return false;
  if (req.profile && !req.profile.every((f) => hasProfileFeature(ctx, f))) return false;
  for (const t of skill.tools) {
    if (isBuiltin(t)) continue;
    const tool = reg.tools.get(t);
    if (!tool || !tool.available(ctx)) return false;
  }
  if (req.skills) {
    const path = new Set(visiting).add(skill.name);
    for (const name of req.skills) {
      const dep = reg.skills.get(name);
      if (!dep || dep.kind !== 'capability' || !isSkillAvailable(reg, ctx, dep, path)) return false;
    }
  }
  return true;
}
