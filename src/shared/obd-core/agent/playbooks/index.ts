/** The 17 symptom playbooks of the AI diagnostic agent (plan 34c): `bolid.skill.v1` documents
 *  (`kind: 'playbook'`) that tell the model which capability skills and tools to use for a
 *  complaint, ten of them with an on-device procedure (`procedures.ts`, procedure id = playbook
 *  name). Playbooks name only built-in and core tools, so the registry accepts them with or without
 *  the feature contributions; a playbook that needs a feature says so in `requires.skills`.
 *  Composed by the app layer after the features (`src/app/ai-diagnose.tsx`).
 *  See docs/features/ai-diagnose.md. */

import { parseSkillFileOrThrow } from '../skillFile';
import type { AgentContribution } from '../types';
import { PLAYBOOK_PROCEDURES } from './procedures';
import batteryCharging from './battery_charging.skill.json';
import beforeLongTrip from './before_long_trip.skill.json';
import boost from './boost.skill.json';
import checkEngineLight from './check_engine_light.skill.json';
import cooling from './cooling.skill.json';
import dpfRegen from './dpf_regen.skill.json';
import egr from './egr.skill.json';
import fuelTrims from './fuel_trims.skill.json';
import glowPlugs from './glow_plugs.skill.json';
import hardStart from './hard_start.skill.json';
import highConsumption from './high_consumption.skill.json';
import keepsDisconnecting from './keeps_disconnecting.skill.json';
import limpMode from './limp_mode.skill.json';
import misfire from './misfire.skill.json';
import roughIdle from './rough_idle.skill.json';
import smoke from './smoke.skill.json';
import usedCar from './used_car.skill.json';

export * from './procedures';

const FILES: Record<string, unknown> = {
  fuel_trims: fuelTrims,
  boost,
  battery_charging: batteryCharging,
  cooling,
  misfire,
  dpf_regen: dpfRegen,
  used_car: usedCar,
  check_engine_light: checkEngineLight,
  before_long_trip: beforeLongTrip,
  keeps_disconnecting: keepsDisconnecting,
  hard_start: hardStart,
  rough_idle: roughIdle,
  limp_mode: limpMode,
  high_consumption: highConsumption,
  smoke,
  glow_plugs: glowPlugs,
  egr,
};

/** The playbook names, in the order the model's skill index lists them. */
export const PLAYBOOK_NAMES = Object.keys(FILES);

export const PLAYBOOK_CONTRIBUTION: AgentContribution = {
  skills: Object.entries(FILES).map(([name, raw]) => parseSkillFileOrThrow(raw, name)),
  procedures: PLAYBOOK_PROCEDURES,
};
