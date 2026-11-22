/** Shared types of the AI diagnostic agent (plan 34a): tools, skills' procedures, the context a
 *  tool runs in, the steps a run records and how a run ends. Later plans (34b-34d) extend these by
 *  name, so the names and shapes are a contract. See docs/features/ai-diagnose.md. */

import type {
  AiChatMessage,
  AiJsonSchema,
  DiagSeverity,
  VehicleContext,
} from '../analysis/aiDiagnosis';
import type { ProtocolId } from '../obd/protocols';
import type { VehicleProfile } from '../../vehicles/types';
import type { ReadOnlySession } from './readOnlySession';
import type { SkillFile } from './skillFile';

/** The fixed list of things the agent may ask the (stationary) driver to do. */
export type DriverInstructionId =
  | 'start_engine_idle'
  | 'engine_off_ignition_on'
  | 'restart_engine'
  | 'hold_2500_rpm'
  | 'electrical_load_on'
  | 'electrical_load_off'
  | 'wiggle_connector'; // 34b/34c extend this union

/** How an `ask_driver` step ended. */
export type DriverReply =
  | { kind: 'done' }
  | { kind: 'cant' }
  | { kind: 'timeout' }
  | { kind: 'moving' }
  | { kind: 'refused'; reason: 'moving' | 'speed_unknown' }
  | { kind: 'choice'; value: string };

/** One argument of a tool: a small JSON-Schema subset `validateArgs` enforces. */
export interface ToolArgProp {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  enum?: readonly (string | number)[];
  items?: { type: 'string' | 'number'; pattern?: string };
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  pattern?: string;
  description?: string;
}

/** A tool's argument object schema. */
export interface ToolArgSchema {
  type: 'object';
  properties: Record<string, ToolArgProp>;
  required?: string[];
}

/** A finding a tool or skill computed on device; translated for the user via `FindingTranslator`. */
export interface SkillFinding {
  key: string;
  severity: DiagSeverity;
  values?: Record<string, string | number>;
  codes?: string[];
  unconfirmed?: boolean;
}

/** What a tool returns: a compact digest for the model and a one-line summary for older steps. */
export interface ToolResult {
  digest: string;
  summary: string;
  findings?: SkillFinding[];
  unconfirmed?: boolean;
  status?: 'ok' | 'error';
  /** Structured result for procedures that call this tool; never sent to the model. */
  data?: unknown;
}

/** What decides whether a tool or skill is offered for the connected car. */
export interface AvailabilityContext {
  profile: VehicleProfile;
  protocol: ProtocolId;
  supportedPids: readonly string[];
  canMonitor: boolean;
}

/** What a tool's `run` receives. The session is the read-only facade, never `DiagnosticSession`. */
export interface ToolContext {
  session: ReadOnlySession;
  profile: VehicleProfile;
  guideProfileId: string;
  vehicle: VehicleContext;
  vin: string | null;
  now(): number;
  sleep(ms: number): Promise<void>;
  signal: AbortSignal;
  askDriver(id: DriverInstructionId): Promise<DriverReply>;
}

/** What a skill procedure receives: the tool context plus calls into other tools and procedures. */
export interface ProcedureContext extends ToolContext {
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  runProcedure(id: string): Promise<ToolResult>;
}

/** A read-only capability the model can call by name. */
export interface AgentTool {
  name: string;
  description: string;
  labelKey: string;
  args: ToolArgSchema;
  costMs: number;
  triage?: { args: Record<string, unknown> };
  available(ctx: AvailabilityContext): boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** A skill's on-device procedure, run in one step through `run_skill`. */
export interface SkillProcedure {
  id: string;
  costMs: number;
  run(ctx: ProcedureContext): Promise<ToolResult>;
}

/** What a feature contributes to the agent registry. */
export interface AgentContribution {
  tools?: AgentTool[];
  skills?: SkillFile[];
  procedures?: SkillProcedure[];
}

/** One recorded step of a run. */
export interface AgentStep {
  id: number;
  kind: 'triage' | 'tool' | 'skill' | 'driver' | 'invalid';
  tool?: string;
  args?: Record<string, unknown>;
  why: string;
  digest: string;
  summary: string;
  label: { key: string; values?: Record<string, string | number> };
  status: 'ok' | 'error' | 'cant' | 'refused';
  unconfirmed?: boolean;
  findings?: SkillFinding[];
  durationMs: number;
}

/** What the user asked for. */
export interface AgentRunRequest {
  mode: 'symptom' | 'everything';
  symptom?: string;
  focusCode?: string;
}

/** Why a run ended. */
export type AgentEnd =
  | 'final'
  | 'no_ai'
  | 'steps'
  | 'time'
  | 'adapter'
  | 'invalid'
  | 'stopped'
  | 'disconnected'
  | 'ai_error';

/** One structured model call: returns the reply text, or null when the model gave nothing. */
export type AgentChat = (
  messages: AiChatMessage[],
  schema: AiJsonSchema,
  signal: AbortSignal,
) => Promise<string | null>;

/** Turns an on-device finding into translated report text. */
export type FindingTranslator = (f: SkillFinding) => { title: string; detail: string };
