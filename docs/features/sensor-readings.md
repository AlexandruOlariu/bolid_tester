# Feature: sensor-readings

Every live Mode 01 sensor the car reports, **grouped by system**, plus the profile's
**injection** DIDs on CAN cars. A read-only "all sensors" overview next to the gauge dashboard in
[live-data](./live-data.md). Reachable from **More → Sensor readings** (`/sensor-readings`).

> Scheduled to fold into the Live tab as an **All sensors** view in
> [plan 07](../plans/07-information-architecture.md). That plan deletes this slice and this spec
> together and moves the content into [live-data](./live-data.md). It needs no `ALIASES` entry in
> `src/shared/lib/featureDocsSync.test.ts`: the test reports an alias whose slice does not exist.
> An alias is only needed if the slice stays while the spec goes.

## UI

- **SensorReadingsScreen** (`ui/SensorReadingsScreen.tsx`), title "Sensor readings".
- Not connected → "Not connected. Connect an adapter or the simulator first."
- Connected → one section per group in `GROUPS`, each a wrap of `ValueCard`s (name, value, unit).
  A group with no reported value is not shown, so a PID the ECU does not support never appears:

  | Group            | PIDs                                                                                                                                               |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Engine           | `010C` RPM, `010D` speed, `0104` load, `0111` throttle, `010E` timing advance, `011F` run time                                                     |
  | Temperatures     | `0105` coolant, `010F` intake air, `0146` ambient air, `015C` engine oil                                                                           |
  | Air & boost      | `010B` intake MAP, `0110` MAF, `0133` barometric pressure                                                                                          |
  | Fuel & injection | `010A` fuel pressure, `0122` / `0123` fuel rail pressure, `015E` fuel rate, `0106` / `0107` short / long fuel trim B1, `0144` λ, `012F` fuel level |
  | Electrical       | `0142` module voltage                                                                                                                              |
  | Distance         | `0121` distance with MIL, `0131` distance since codes cleared                                                                                      |
  | Other            | every polled Mode 01 value whose PID is in no group above (extended `22:<DID>` keys are never listed — they belong to Extended PIDs)               |

  The subtitle reads "Live — every supported sensor, grouped" while the poll loop is reading.

- **Injection** section, with a **Refresh** button:
  - shown with values when the selected profile has `extendedPids` with `category: 'injection'`
    **and** the session protocol is CAN (`isCan`). The Golf profile ships five: `1709` injection
    quantity and `170A`–`170D` per-cylinder injector corrections (illustrative Mode 22 DIDs, see
    [extended-pids](./extended-pids.md));
  - otherwise a card, "Per-injector data isn't available here", explaining that injector data
    lives in manufacturer measuring blocks a generic ELM327 cannot read over standard OBD2 (above
    all on K-line), and that the Fuel & injection group is the generic substitute.

## hooks

- Uses `useLiveData()` from [live-data](./live-data.md) with no explicit PID list, so it registers
  the whole effective PID set while mounted; EngineHost's single poll loop
  ([engine-host](./engine-host.md)) reads it. No hook or store of its own.
- Injection DIDs are read once when the screen mounts, again when the session or the selected
  profile changes, and on **Refresh**: `session.readExtended(did)` one by one, decoded by each
  DID's `decode`; `null` when the ECU gives no answer. Failures log `source: 'sensor-readings'`
  (warning). Live-data updates re-render the screen but do **not** re-read the DIDs: the injection
  list is memoised on the profile id, so the read callback keeps its identity. Otherwise every poll
  sweep would add five Mode 22 requests on the half-duplex adapter EngineHost's loop also uses.
- Each read takes a run id. A newer read (session / profile change or **Refresh**) or unmounting
  supersedes it: the superseded read sends no further DID requests and never sets state, so an
  older profile's or session's values cannot overwrite a newer read's.

## model

None (one screen file). Known layering debt: it imports `useLiveData` from
`features/live-data` and `useVehicleStore` from `features/vehicle-select`, a feature → feature
dependency the [architecture](../architecture.md#ui-feature-sliced) rule forbids. Plan 07 removes it
by moving the view into `live-data`.

## Acceptance

- In the simulator (Golf), the screen shows Engine, Temperatures, Air & boost, Fuel & injection,
  Electrical and Distance cards for the PIDs the profile supports, and the Injection section lists
  the five Golf DIDs with values.
- On the Passat (K-line) profile the Injection section shows the "not available here" card; no
  Mode 22 request is sent.
- Leaving the screen releases its PID registration (the poll loop stops reading PIDs nothing else
  needs).
- Live-data updates while the screen is open send no further Mode 22 requests; only **Refresh**
  does.
- Pressing **Refresh** during a read, or leaving the screen, stops the earlier read after its
  current DID; its result is discarded.

## Tests

`ui/SensorReadingsScreen.test.tsx`: against the simulated Golf, the five injection DIDs are read
once on mount (`readExtended` called 5 times), and three live-data updates afterwards leave the
count at 5. The test fails (11 calls) if the injection list is rebuilt on every render. Two more
tests hold the first DID read open: pressing **Refresh** meanwhile, then releasing it, leaves the
count at 6 (1 + 5; the stale run sends nothing more), and unmounting before releasing it leaves the
count at 1. Both fail without the run-id check.
