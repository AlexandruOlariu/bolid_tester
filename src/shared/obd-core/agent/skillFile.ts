/** The agent skill file format `bolid.skill.v1` (plan 34a): a declarative document that tells the
 *  model which tools to use for a capability or symptom and how to read the results. Model-facing
 *  text stays English. See docs/features/ai-diagnose.md. */

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
