/** The fixed list of things the AI diagnostic agent may ask the driver to do (plan 34a), each with
 *  its model-facing English text and the translation key the driver prompt shows. Only a stationary
 *  car is ever asked; the gate lives in the agent loop. See docs/features/ai-diagnose.md. */

import type { DriverInstructionId } from './types';

export interface DriverInstruction {
  /** Model-facing text (English). */
  en: string;
  /** User-facing text: `aiDiagnose:agent.driver.<id>`. */
  labelKey: string;
  /** Answer choices beyond Done / Can't, for an instruction that asks a question. */
  choices?: readonly string[];
}

export const DRIVER_INSTRUCTIONS: Record<DriverInstructionId, DriverInstruction> = {
  start_engine_idle: {
    en: 'Start the engine and let it idle.',
    labelKey: 'aiDiagnose:agent.driver.start_engine_idle',
  },
  engine_off_ignition_on: {
    en: 'Switch the engine off and leave the ignition on.',
    labelKey: 'aiDiagnose:agent.driver.engine_off_ignition_on',
  },
  restart_engine: {
    en: 'Switch the engine off, then start it again.',
    labelKey: 'aiDiagnose:agent.driver.restart_engine',
  },
  hold_2500_rpm: {
    en: 'In Park or Neutral, bring the engine to 2500 rpm, tap Done and keep holding until the next message (about 10 seconds).',
    labelKey: 'aiDiagnose:agent.driver.hold_2500_rpm',
  },
  electrical_load_on: {
    en: 'Switch on the headlights, the A/C and the rear demister.',
    labelKey: 'aiDiagnose:agent.driver.electrical_load_on',
  },
  electrical_load_off: {
    en: 'Switch the headlights, the A/C and the rear demister off.',
    labelKey: 'aiDiagnose:agent.driver.electrical_load_off',
  },
  wiggle_connector: {
    en: 'With the engine idling, gently flex the wiring and connector of the sensor the app is watching for 10 seconds.',
    labelKey: 'aiDiagnose:agent.driver.wiggle_connector',
  },
  smoke_colour: {
    en: 'With the engine running, look at the exhaust: what colour is the smoke?',
    labelKey: 'aiDiagnose:agent.driver.smoke_colour',
    choices: ['white', 'blue', 'black', 'grey', 'none'],
  },
};
