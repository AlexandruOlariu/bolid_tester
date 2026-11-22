/** The trip-recording feature's contribution to the AI diagnostic agent (plan 34b): `list_trips`
 *  (this car's saved trips, newest first), `read_trip` (one trip's per-PID min / avg / max and the
 *  coolant warm-up; `latest_cold` picks the newest cold-start trip) and `read_fuel_economy` (the
 *  instant consumption from live values plus the last trips' averages), with the `trips` and
 *  `fuel_economy` capability skills. Every trip tool reads the **active car's** trips only
 *  (`getActiveProfile().id`, garage-aware) and never touches another car's. Composed by the app
 *  layer (`src/app/ai-diagnose.tsx`). See docs/features/trip-recording.md. */

import {
  FUEL_ECONOMY_PIDS,
  PID_REGISTRY,
  clampDigest,
  fuelEconomyFromValues,
  oneDecimal,
  parseSkillFileOrThrow,
  sampleLivePids,
  tripFuelAverage,
} from '@/shared/obd-core';
import type {
  AgentContribution,
  AgentTool,
  ToolContext,
  ToolResult,
  TripHeader,
  TripSample,
} from '@/shared/obd-core';
import { getActiveProfile } from '@/shared/state/activeProfile';
import type { Fuel } from '@/shared/vehicles';
import { loadTripSamples } from '../hooks/useTripRecorder';
import { tripCarKey, useTripStore, type TripSummary } from '../model/tripStore';
import fuelEconomySkill from './fuel_economy.skill.json';
import tripsSkill from './trips.skill.json';

/** Newest trips `list_trips` lists (each may read its CSV for the fuel average). */
export const LIST_TRIPS_MAX = 10;
/** Trips `read_fuel_economy` averages. */
export const FUEL_TRIPS = 5;
/** Newest trips `read_trip {id:'latest_cold'}` searches for a cold start. */
export const LATEST_COLD_SEARCH = 20;
/** A trip whose first coolant sample is at or under this started cold (°C). */
export const COLD_START_C = 40;
/** Coolant temperature that counts as warmed up (°C). */
export const WARM_C = 80;
/** PIDs `read_trip` summarises when none are asked for (those the trip logged). */
export const READ_TRIP_DEFAULT_PIDS = ['0105', '010C', '010B', '010D'] as const;
const READ_TRIP_MAX_PIDS = 8;
const LATEST_COLD = 'latest_cold';

const NO_TRIPS = 'No trips recorded for this car.';
const COOLANT = '0105';
const RPM = '010C';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A local `yyyy-mm-dd hh:mm`, the time the user saw the trip at. */
function localDateTime(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

const minutes = (ms: number): number => Math.round(ms / 60_000);

/** The active car's trips, newest first. */
function activeCarTrips(): TripSummary[] {
  const carId = getActiveProfile().id;
  return useTripStore
    .getState()
    .trips.filter((t) => tripCarKey(t) === carId)
    .sort((a, b) => b.header.startedAt - a.header.startedAt);
}

/** A trip's average L/100 km: the stored fuel stats, else computed from its CSV samples; null when
 *  the trip logged no fuel path (`015E` / `0110`) or no distance. */
async function tripLitresPer100km(t: TripSummary, fuel: Fuel): Promise<number | null> {
  if (t.stats.fuel) return t.stats.fuel.litresPer100km;
  try {
    const samples = await loadTripSamples(t.header);
    return samples.length ? tripFuelAverage(samples, fuel).litresPer100km : null;
  } catch {
    return null;
  }
}

const kmText = (km: number | null | undefined): string =>
  km == null ? 'distance n/a' : `${oneDecimal(km)} km`;

const fuelText = (l100: number | null): string =>
  l100 == null ? 'no fuel data' : `${oneDecimal(l100)} L/100 km`;

/** `"<id> <yyyy-mm-dd hh:mm> <min> min, <km> km, max coolant <°C>, max rpm <rpm>, <L/100 km>"`. */
async function tripLine(t: TripSummary, fuel: Fuel): Promise<string> {
  const max = t.stats.max ?? {};
  const coolant = max[COOLANT] == null ? 'n/a' : `${Math.round(max[COOLANT])} °C`;
  const rpm = max[RPM] == null ? 'n/a' : `${Math.round(max[RPM])}`;
  const l100 = await tripLitresPer100km(t, fuel);
  return (
    `${t.header.id} ${localDateTime(t.header.startedAt)} ${minutes(t.stats.durationMs)} min, ` +
    `${kmText(t.stats.distanceKm)}, max coolant ${coolant}, max rpm ${rpm}, ${fuelText(l100)}`
  );
}

async function listTrips(_args: Record<string, unknown>): Promise<ToolResult> {
  const trips = activeCarTrips();
  if (trips.length === 0) return { digest: NO_TRIPS, summary: 'Trips: none' };
  const fuel = getActiveProfile().fuel;
  const shown = trips.slice(0, LIST_TRIPS_MAX);
  const lines = [`${trips.length} trips for this car, newest first:`];
  for (const t of shown) lines.push(await tripLine(t, fuel));
  if (trips.length > shown.length) lines.push(`… (${trips.length - shown.length} older trips)`);
  return {
    digest: clampDigest(lines.join('\n'), undefined, { countMore: true }),
    summary: `Trips: ${trips.length}`,
  };
}

/** The first non-null value of `pid` in sample order, with its time. */
function firstValue(samples: TripSample[], pid: string): { t: number; v: number } | null {
  for (const s of samples) {
    const v = s.values[pid];
    if (v != null) return { t: s.t, v };
  }
  return null;
}

/** `"warm-up 9 min"` from the first coolant sample at or under 40 °C to the first at or over 80 °C,
 *  `"started warm"` when the trip began above 40 °C. */
function warmUpText(samples: TripSample[]): string | null {
  const first = firstValue(samples, COOLANT);
  if (!first) return null;
  if (first.v > COLD_START_C) return 'started warm';
  const warm = samples.find((s) => {
    const v = s.values[COOLANT];
    return s.t >= first.t && v != null && v >= WARM_C;
  });
  const last = samples[samples.length - 1];
  return warm
    ? `warm-up ${minutes(warm.t - first.t)} min`
    : `did not reach ${WARM_C} °C in ${minutes(last.t - first.t)} min`;
}

const isColdStart = (samples: TripSample[]): boolean => {
  const first = firstValue(samples, COOLANT);
  return first != null && first.v <= COLD_START_C;
};

function pidLine(pid: string, samples: TripSample[]): string {
  const desc = PID_REGISTRY[pid];
  const name = desc ? `${pid} ${desc.name}` : pid;
  const values = samples
    .map((s) => s.values[pid])
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return `${name}: not logged`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const unit = desc?.unit ? ` ${desc.unit}` : '';
  return `${name}: min ${oneDecimal(min)} / avg ${oneDecimal(avg)} / max ${oneDecimal(max)}${unit} (n=${values.length})`;
}

/** The requested PIDs, else the default set the trip logged. */
function pidsToSummarise(raw: unknown, samples: TripSample[]): string[] {
  const asked = Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter((p): p is string => typeof p === 'string').map((p) => p.toUpperCase()),
        ),
      ]
    : [];
  if (asked.length) return asked.slice(0, READ_TRIP_MAX_PIDS);
  return READ_TRIP_DEFAULT_PIDS.filter((p) => samples.some((s) => s.values[p] != null));
}

async function loadSamples(
  header: TripHeader,
): Promise<{ ok: true; samples: TripSample[] } | { ok: false; error: string }> {
  try {
    return { ok: true, samples: await loadTripSamples(header) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const readError = (id: string, error: string): ToolResult => ({
  digest: `Could not read trip ${id}: ${error}`,
  summary: `Trip ${id}: read failed`,
  status: 'error',
});

async function readTrip(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const id = String(args.id ?? '');
  const trips = activeCarTrips();
  let trip: TripSummary | undefined;
  let samples: TripSample[] = [];

  if (id === LATEST_COLD) {
    for (const t of trips.slice(0, LATEST_COLD_SEARCH)) {
      if (ctx.signal.aborted) break;
      const loaded = await loadSamples(t.header);
      // An unreadable trip cannot be the cold start; keep looking at older ones.
      if (loaded.ok && isColdStart(loaded.samples)) {
        trip = t;
        samples = loaded.samples;
        break;
      }
    }
    if (!trip) {
      const digest = trips.length
        ? `No cold-start trip (coolant ≤ ${COLD_START_C} °C at the start) recorded for this car.`
        : NO_TRIPS;
      return { digest, summary: 'Trip: no cold start' };
    }
  } else {
    trip = trips.find((t) => t.header.id === id);
    if (!trip)
      return { digest: `Trip ${id} not found for this car.`, summary: `Trip ${id}: not found` };
    const loaded = await loadSamples(trip.header);
    if (!loaded.ok) return readError(id, loaded.error);
    samples = loaded.samples;
  }

  const { header, stats } = trip;
  const head =
    `Trip ${header.id} ${localDateTime(header.startedAt)}: ${minutes(stats.durationMs)} min, ` +
    `${kmText(stats.distanceKm)}, ${samples.length} samples`;
  if (samples.length === 0) {
    return {
      digest: `${head}. Its samples were not saved on this phone.`,
      summary: `Trip ${header.id}: no samples`,
      data: { header, samples },
    };
  }
  const lines = [head];
  for (const pid of pidsToSummarise(args.pids, samples)) {
    let line = pidLine(pid, samples);
    if (pid === COOLANT) {
      const warmUp = warmUpText(samples);
      if (warmUp) line += `; ${warmUp}`;
    }
    lines.push(line);
  }
  return {
    digest: clampDigest(lines.join('\n')),
    summary: `Trip ${header.id}: ${minutes(stats.durationMs)} min`,
    data: { header, samples },
  };
}

async function readFuelEconomy(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const fuel = getActiveProfile().fuel;
  const sample = await sampleLivePids(ctx, [...FUEL_ECONOMY_PIDS], 0);
  const values: Record<string, number> = {};
  for (const s of sample.series) values[s.pid] = s.values[0];
  const now = fuelEconomyFromValues(values, fuel);
  const source = now?.source === 'fuel-rate' ? 'fuel rate 015E' : 'MAF 0110 estimate';
  let instant: string;
  if (!now) instant = 'Instant: not available (no answer from fuel rate 015E or MAF 0110).';
  else if (now.litresPer100km == null)
    instant = `Instant: ${oneDecimal(now.litresPerHour)} L/h at standstill (${source}).`;
  else
    instant =
      `Instant: ${oneDecimal(now.litresPer100km)} L/100 km at ${oneDecimal(values['010D'])} km/h ` +
      `(${source}).`;

  const trips = activeCarTrips().slice(0, FUEL_TRIPS);
  const lines = [instant];
  if (trips.length === 0) lines.push(NO_TRIPS);
  else {
    lines.push(`Last ${trips.length} trips:`);
    for (const t of trips) {
      const l100 = await tripLitresPer100km(t, fuel);
      lines.push(
        `${t.header.id} ${localDateTime(t.header.startedAt)}: ${fuelText(l100)} over ${kmText(t.stats.distanceKm)}`,
      );
    }
  }
  const summaryNow = !now
    ? 'n/a'
    : now.litresPer100km == null
      ? `${oneDecimal(now.litresPerHour)} L/h`
      : `${oneDecimal(now.litresPer100km)} L/100 km`;
  return { digest: clampDigest(lines.join('\n')), summary: `Fuel: ${summaryNow}` };
}

const listTripsTool: AgentTool = {
  name: 'list_trips',
  description:
    "List this car's recorded trips, newest first: id, start time, minutes, km, max coolant °C, " +
    'max rpm and average L/100 km.',
  labelKey: 'tripRecording:agent.tool.list_trips',
  args: { type: 'object', properties: {} },
  costMs: 0,
  available: () => true,
  run: listTrips,
};

const readTripTool: AgentTool = {
  name: 'read_trip',
  description:
    'Summarise one recorded trip: per PID min / avg / max and the coolant warm-up minutes ' +
    '(cold start ≤ 40 °C to 80 °C). id "latest_cold" picks the newest cold-start trip.',
  labelKey: 'tripRecording:agent.tool.read_trip',
  args: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'A trip id from list_trips, or "latest_cold".' },
      pids: {
        type: 'array',
        items: { type: 'string', pattern: '^[0-9A-F]{4}$' },
        maxItems: READ_TRIP_MAX_PIDS,
        description: 'PIDs to summarise; default 0105, 010C, 010B, 010D when logged.',
      },
    },
    required: ['id'],
  },
  costMs: 0,
  available: () => true,
  run: readTrip,
};

const readFuelEconomyTool: AgentTool = {
  name: 'read_fuel_economy',
  description:
    'Instant fuel consumption (L/100 km, or L/h at standstill) from live fuel rate or MAF, plus ' +
    "the average L/100 km and distance of this car's last 5 trips.",
  labelKey: 'tripRecording:agent.tool.read_fuel_economy',
  args: { type: 'object', properties: {} },
  costMs: 1000,
  available: () => true,
  run: readFuelEconomy,
};

export const agentTools: AgentContribution = {
  tools: [listTripsTool, readTripTool, readFuelEconomyTool],
  skills: [
    parseSkillFileOrThrow(tripsSkill, 'trips'),
    parseSkillFileOrThrow(fuelEconomySkill, 'fuel_economy'),
  ],
};
