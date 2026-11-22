/** Build the Settings "Export as replay fixture" file: the adapter log as a `ReplayFixture` with
 *  `pairs`, `sequences` and a `meta` block (source, vehicle, flow, adapter, protocol, app version),
 *  plus a file name that carries the vehicle and the flow. Pure, so it is unit-tested without the
 *  file system. The committed-fixture rules are in docs/simulator.md → "Replay fixtures". */
import { fixtureFromLog, LoggedIo, ReplayFixture, ReplayFixtureMeta } from '@/shared/obd-core';
import { curatedProfileId, type UserVehicle } from '@/shared/vehicles';
import { resolveProfile, simulatorSourceFor } from '@/shared/vehicles/resolve';

/** Default flow name in the Settings field. */
export const DEFAULT_FLOW_NAME = 'session';

export interface ReplayExportInput {
  log: LoggedIo[];
  /** Flow name typed in Settings (`connect`, `faults`, …); blank → `session`. */
  flow: string;
  /** Registry id (see `fixtureVehicleId`). */
  vehicleId: string;
  /** `simulator` when the log came from the in-app simulator: such a file is never validation. */
  source: ReplayFixtureMeta['source'];
  /** The live session's adapter version (ATI) and negotiated protocol, when connected. */
  adapter?: string;
  protocol?: string;
  /** Entries the adapter log's ring buffer dropped before the export (it wrapped); recorded in
   *  `meta.droppedEntries` when > 0 so a mid-session fixture is never mistaken for a full one. */
  droppedEntries?: number;
  appVersion: string;
  now?: Date;
}

/** The registry id a fixture is filed under (`fixtures/<vehicleId>/`, checked against the folder
 *  name and the vehicle doc by `fixtures.replay.test.ts`). A garage car (`user:` id, plan 06)
 *  exports its base registry profile: what the simulator ran for a simulated garage car, and the
 *  curated profile behind the selected one on the car. */
export function fixtureVehicleId(
  opts: { simulator: boolean; simulatedVehicleId: string; selectedProfileId: string },
  garage: UserVehicle[],
): string {
  return opts.simulator
    ? simulatorSourceFor(opts.simulatedVehicleId, garage).profileId
    : curatedProfileId(resolveProfile(opts.selectedProfileId, garage));
}

/** Lower-case kebab slug safe for a file name: `Module scan!` → `module-scan`. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `bolid-replay-<vehicleId>-<flow>-<stamp>.json`; `user:<id>` vehicle ids become `user-<id>`. */
export function replayFileName(vehicleId: string, flow: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const vehicle = slugify(vehicleId) || 'vehicle';
  return `bolid-replay-${vehicle}-${slugify(flow) || DEFAULT_FLOW_NAME}-${stamp}.json`;
}

export function buildReplayExport(input: ReplayExportInput): {
  fileName: string;
  fixture: ReplayFixture;
} {
  const now = input.now ?? new Date();
  const flow = slugify(input.flow) || DEFAULT_FLOW_NAME;
  const meta: ReplayFixtureMeta = {
    source: input.source,
    vehicleId: input.vehicleId,
    flow,
    adapter: input.adapter,
    protocol: input.protocol,
    appVersion: input.appVersion,
  };
  if (input.droppedEntries && input.droppedEntries > 0) meta.droppedEntries = input.droppedEntries;
  const fixture = fixtureFromLog(input.log, flow, { meta, keepSequences: true });
  fixture.createdAt = now.getTime();
  return { fileName: replayFileName(input.vehicleId, flow, now), fixture };
}
