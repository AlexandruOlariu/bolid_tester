/** Record the simulator into replay fixtures: for every registry profile, `MockTransport(
 *  buildScenario(id))` is driven through the `connect`, `faults` and `clear` flows and each flow is
 *  saved as `fixtures/<id>/sim-<flow>.json` with `meta.source: 'simulator'` and an `expect` block
 *  derived from the SCENARIO (not from the recording, so the replay test is an independent check).
 *
 *  `scripts/record-sim-fixtures.ts` (`npm run fixtures:sim`) writes the files;
 *  `sim-fixtures.freshness.test.ts` re-records and fails when the committed files drift from the
 *  simulator or a profile. Simulator fixtures exercise the pipeline; they are never validation.
 *  See docs/simulator.md → "Replay fixtures". */

import { MockTransport, SimScenario } from './MockTransport';
import { buildScenario } from './scenarios';
import { recordSession } from './recordingTransport';
import { ReplayFixture, ReplayFixtureExpect } from './logReplay';
import { DiagnosticSession, SessionInfo } from '../session/DiagnosticSession';
import { isMarkerPid } from '../obd/pids';
import { VEHICLE_PROFILES } from '../../vehicles';

export const SIM_FIXTURE_FLOWS = ['connect', 'faults', 'clear'] as const;
export type SimFixtureFlow = (typeof SIM_FIXTURE_FLOWS)[number];

/** Stored codes seeded for a profile with no `knownFaults`, so its faults / clear flows have
 *  something to read and clear. Generic sensor / supply codes valid on any engine. */
export const SIM_FALLBACK_STORED_DTCS = ['P0113', 'P0562'];

const NOTES =
  'Recorded from the simulator (MockTransport + buildScenario) by scripts/record-sim-fixtures.ts. ' +
  'Exercises the fixture pipeline; not a validation on the car.';

/** The scenario a flow records: the profile's own, with the known stored faults (or the fallback
 *  codes) seeded for the DTC flows. `overrides` (tests) change any scenario value. */
export function simFixtureScenario(
  profileId: string,
  flow: SimFixtureFlow,
  overrides: Partial<SimScenario> = {},
): SimScenario {
  const base = buildScenario(profileId, overrides);
  if (flow === 'connect') return base;
  const stored = base.storedDtcs?.length ? base.storedDtcs : SIM_FALLBACK_STORED_DTCS;
  return { ...base, storedDtcs: [...stored] };
}

/** Supported PIDs a connect should discover: the union of every answering ECU's set. */
function expectedPidCount(s: SimScenario): number {
  const all = new Set(s.supportedPids);
  for (const ecu of s.secondaryEcus ?? []) for (const p of ecu.supportedPids) all.add(p);
  return [...all].filter((p) => !isMarkerPid(p)).length;
}

function expectFor(flow: SimFixtureFlow, s: SimScenario): ReplayFixtureExpect {
  const out: ReplayFixtureExpect = {
    protocol: s.protocol,
    vin: s.vinSupported !== false && s.vin ? s.vin : null,
    supportedPidCount: expectedPidCount(s),
  };
  if (flow === 'connect') return out;
  const stored = [...(s.storedDtcs ?? [])];
  out.storedDtcs = stored;
  out.pendingDtcs = [...(s.pendingDtcs ?? [])];
  out.milOn = stored.length > 0;
  if (flow === 'faults') out.freezeFrameCount = Math.min(stored.length, 5);
  if (flow === 'clear') out.storedDtcsAfterClear = [];
  return out;
}

/** Drive one flow — mirrors what the app's screens do: connect (Connect), then readiness, Mode 03
 *  and 07 and the freeze frames (Faults); clear = read, `04`, re-read. Returns the connect info. */
async function runFlow(flow: SimFixtureFlow, session: DiagnosticSession): Promise<SessionInfo> {
  const info = await session.connect();
  if (flow === 'connect') return info;
  await session.readReadiness();
  await session.readDtcs('03');
  await session.readDtcs('07');
  if (flow === 'faults') {
    await session.readFreezeFrames();
    return info;
  }
  await session.clearDtcs();
  await session.readDtcs('03');
  await session.readDtcs('07');
  await session.readReadiness();
  return info;
}

/** Record one profile's flow into a deterministic fixture (no `createdAt`, no app version), so the
 *  committed file only changes when the simulator or the profile does. */
export async function recordSimFixture(
  profileId: string,
  flow: SimFixtureFlow,
  overrides: Partial<SimScenario> = {},
): Promise<ReplayFixture> {
  const scenario = simFixtureScenario(profileId, flow, overrides);
  const expectations = expectFor(flow, scenario);
  let info: SessionInfo | null = null;
  const recorded = await recordSession(
    new MockTransport(scenario),
    async (session) => {
      info = await runFlow(flow, session);
    },
    { source: 'simulator', vehicleId: profileId, flow },
    { commandTimeoutMs: 1000, firstCommandTimeoutMs: 1000 },
  );
  const connected = info as SessionInfo | null;
  return {
    name: `sim-${flow}`,
    pairs: recorded.pairs,
    sequences: recorded.sequences,
    meta: {
      source: 'simulator',
      vehicleId: profileId,
      flow,
      adapter: connected?.version,
      protocol: connected?.protocol,
      notes: NOTES,
    },
    expect: expectations,
  };
}

/** Every simulator fixture, keyed by its path under `transport/fixtures/` (`<id>/sim-<flow>.json`). */
export async function recordAllSimFixtures(): Promise<Record<string, ReplayFixture>> {
  const out: Record<string, ReplayFixture> = {};
  for (const profile of VEHICLE_PROFILES) {
    for (const flow of SIM_FIXTURE_FLOWS) {
      out[`${profile.id}/sim-${flow}.json`] = await recordSimFixture(profile.id, flow);
    }
  }
  return out;
}

/** The exact text a fixture file holds (2-space JSON + trailing newline). */
export function serializeFixture(fixture: ReplayFixture): string {
  return JSON.stringify(fixture, null, 2) + '\n';
}
