/** The vehicle-info feature's contribution to the AI diagnostic agent (plan 34b): the
 *  `read_identity` tool (the VIN as read — the one the run already knows, else Mode 09 PID 02 —
 *  decoded offline by `decodeVin` into make, model year, plant and check digit, plus the calibration
 *  id, the ECU part number on CAN and the protocol label) and the `vehicle_identity` capability
 *  skill. Read only, standard OBD2. Composed by the app layer (`src/app/ai-diagnose.tsx`). See
 *  docs/features/vehicle-info.md. */

import {
  PROTOCOL_LABELS,
  clampDigest,
  decodeVin,
  isCan,
  parseSkillFileOrThrow,
} from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  DecodedVin,
  ToolContext,
  ToolResult,
} from '@/shared/obd-core';
import vehicleIdentitySkill from './vehicle_identity.skill.json';

/** The decoded-VIN lines, or a single line saying why the VIN cannot be decoded. */
function vinLines(d: DecodedVin | null): string[] {
  if (!d) return ['VIN: not reported by the ECU (common on older cars)'];
  if (!d.validFormat) return [`VIN: ${d.vin} (not a valid 17-character VIN)`];
  // The model-year and check-digit conventions are North-American (FMVSS 565); elsewhere they are
  // often not used, so the year is indicative and a wrong check digit means nothing.
  const northAmerican = d.checkDigit.applicable;
  const year =
    d.modelYear == null
      ? 'not encoded in char 10'
      : `${d.modelYear}${northAmerican ? '' : ' (from char 10; often not encoded outside North America)'}`;
  const check = `${d.checkDigit.valid ? 'yes' : 'no'}${northAmerican ? '' : ' (not required outside North America)'}`;
  return [
    `VIN: ${d.vin}`,
    `Make: ${d.manufacturer} (${d.country})`,
    `Model year: ${year}`,
    `Plant code: ${d.plantCode}`,
    `VIN check digit valid: ${check}`,
  ];
}

async function readIdentity(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { session } = ctx;
  const vin = ctx.vin ?? (await session.readVin());
  const decoded = vin ? decodeVin(vin) : null;
  const calibrationId = await session.readCalibrationId();
  const can = isCan(session.currentProtocol);
  const partNumber = can ? await session.readPartNumber() : null;
  const lines = [
    ...vinLines(decoded),
    `Calibration ID: ${calibrationId ?? 'not reported'}`,
    `ECU part number: ${can ? (partNumber ?? 'not reported') : 'not read on this link (CAN only)'}`,
    `Protocol: ${PROTOCOL_LABELS[session.currentProtocol] ?? 'Unknown'}`,
  ];
  const summary = !decoded
    ? 'Identity: no VIN reported'
    : decoded.validFormat
      ? `Identity: ${decoded.manufacturer}${decoded.modelYear ? ` ${decoded.modelYear}` : ''}, ${decoded.vin}`
      : `Identity: invalid VIN ${decoded.vin}`;
  return { digest: clampDigest(lines.join('\n')), summary };
}

const readIdentityTool: AgentTool = {
  name: 'read_identity',
  description:
    'Read the car identity: VIN decoded offline (make, model year, plant, check digit), the ' +
    'calibration id, the engine ECU part number (CAN) and the OBD2 protocol.',
  labelKey: 'vehicleInfo:agent.tool.read_identity',
  args: { type: 'object', properties: {} },
  costMs: 3000,
  available: () => true,
  run: readIdentity,
};

export const agentTools: AgentContribution = {
  tools: [readIdentityTool],
  skills: [parseSkillFileOrThrow(vehicleIdentitySkill, 'vehicle_identity')],
};
