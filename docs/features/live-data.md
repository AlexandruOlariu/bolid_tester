# Feature: live-data

Stream and display live engine parameters (Mode 01 PIDs).

## UI

- **DashboardScreen** (the **Live** tab) — under the title a two-segment switch, **Dashboard** |
  **All sensors** (`role="tab"`, local state, Dashboard on open; leaving the dashboard ends
  Customize):
  - **Dashboard** — a grid of **gauges / value cards** (RPM, speed, coolant, MAP/boost, IAT, load,
    voltage, …) with the fuel-economy card and **Customize** (reorder, hide, **Reset**, saved per
    car). Uses `react-native-svg` gauges from `shared/ui`. **Metric only** (plan 07): gauges, cards
    and the fuel-economy card show the decoded value and unit as they are (km/h, °C, kPa, L/100km,
    L/h); there is no unit setting or conversion layer.
  - **All sensors** — every supported sensor grouped by system, see [All sensors](#all-sensors).

### Accessibility (plan 20)

See [accessibility](../accessibility.md). Each gauge is one `progressbar` element (label + value
text) and each value card one `text` element ("Engine load: 22 %"); neither is a live region — at
the 1 Hz poll rate a screen reader would never stop talking, so values are read when focused. The
Customize icon buttons name their action and item (**Move RPM up**, **Move RPM down**, **Hide RPM**
/ **Show RPM**), 36 dp with an 8 dp hit slop. The big numbers (gauge value, card value, fuel
economy) are capped at 1.3× font scale; above an OS font scale of 1.5 (`LARGE_TEXT_FONT_SCALE`) the
value cards go one per row — full width on a phone (in both the Dashboard and All sensors views,
injection tiles included), one per row in the tablet card column. Arc and
track colours are the theme's `$accent` / `$gaugeTrack`.

### Tablet and landscape layout (plan 21)

The Dashboard segment follows the window's layout class (`useLayoutClass`, see
[architecture](../architecture.md#ui-feature-sliced)):

- **compact** (a phone in portrait, < 600 dp): unchanged — fuel-economy card, gauges, then the
  value-card grid; Customize replaces gauges and cards with the item list.
- **medium / expanded** (≥ 600 dp — a tablet, or a phone on its side): the Dashboard | All sensors
  switch and the Customize toolbar stay above two columns. The two-pane row (`live-row`) measures
  itself with `onLayout` (so the side rail and the 24 dp padding are already out; until the first
  layout it is estimated as the window minus the padding), and the pure `model/twoPaneGrid.ts` sizes
  it. The **left** column (`testID="live-left"`, 45 % of the row, at most 360 dp) holds the gauges
  and then the fuel-economy card; it is **left out** when it would be empty (every gauge hidden in
  Customize and no fuel-economy result), and the cards take the whole row. The **right** one
  (`live-right`, `flex: 1`) holds the value cards: as many ≥ 150 dp cards per row as the column fits,
  at most three on expanded and two on medium, each given an exact `ValueCard width` so the row is
  filled (a column too narrow for two holds one full-width card, never a 150 dp card and a gap; a
  short last row keeps the grid's card width). Customize lists the items in the right column
  while the gauges stay visible on the left. Gauges are 180 dp on expanded (150 otherwise). The
  screen uses the full width (`Screen wide`).

The All sensors segment keeps the centred, width-capped column of every other screen.

### Dashboard presets by fuel

`presetFor(fuel)` (`model/dashboardLayout.ts`, pure, plan 07) is the layout a car with **no saved
Customize layout** starts from, chosen from the active profile's `fuel` (a garage car's own fuel):

| Fuel            | Order (after the RPM, speed and coolant gauges)                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| diesel          | boost / MAP `010B`, oil temperature `015C`, MAF `0110`, fuel rate `015E`, module voltage `0142`              |
| petrol, LPG     | fuel trims `0106` / `0107`, timing advance `010E`, MAP `010B`, MAF `0110`, voltage `0142`, fuel level `012F` |
| hybrid          | voltage `0142` first, then the petrol set                                                                    |
| other (generic) | `EMPTY_LAYOUT` — the default order (gauges, then the ECU's PIDs as reported)                                 |

A preset is an explicit **order** only: the named items come first, every other supported PID
follows in the default order, a PID the car does not report is skipped, nothing is hidden. Hiding an
item while nothing is saved starts from the preset (`toggleHidden(profileId, id, base)`), so the
preset order is kept; **Reset** deletes the saved layout and the preset applies again.

### All sensors

`ui/SensorGroups.tsx` (was the standalone Sensor readings screen, folded in by plan 07). It mounts
only while the segment is selected:

- One section per group in `GROUPS`, each a wrap of `ValueCard`s (name, value, unit). A group with
  no reported value is not shown, so a PID the ECU does not support never appears:

  | Group            | PIDs                                                                                                                                               |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Engine           | `010C` RPM, `010D` speed, `0104` load, `0111` throttle, `010E` timing advance, `011F` run time                                                     |
  | Temperatures     | `0105` coolant, `010F` intake air, `0146` ambient air, `015C` engine oil                                                                           |
  | Air & boost      | `010B` intake MAP, `0110` MAF, `0133` barometric pressure                                                                                          |
  | Fuel & injection | `010A` fuel pressure, `0122` / `0123` fuel rail pressure, `015E` fuel rate, `0106` / `0107` short / long fuel trim B1, `0144` λ, `012F` fuel level |
  | Electrical       | `0142` module voltage                                                                                                                              |
  | Distance         | `0121` distance with MIL, `0131` distance since codes cleared                                                                                      |
  | Other            | every polled Mode 01 value whose PID is in no group above (extended `22:<DID>` keys are never listed — they belong to Extended PIDs)               |

  A line above reads "Live — every supported sensor, grouped" while the poll loop is reading.

- **Injection** section, with a **Refresh** button:
  - shown with values when the selected profile has `extendedPids` with `category: 'injection'`
    **and** the session protocol is CAN (`isCan`). The Golf profile ships five: `1709` injection
    quantity and `170A`–`170D` per-cylinder injector corrections (illustrative Mode 22 DIDs, see
    [extended-pids](./extended-pids.md));
  - otherwise a card, "Per-injector data isn't available here", explaining that injector data
    lives in manufacturer measuring blocks a generic ELM327 cannot read over standard OBD2 (above
    all on K-line), and that the Fuel & injection group is the generic substitute.
- Registration: `useLiveData()` with **no** PID list, so the view registers the whole effective PID
  set while it is shown; the dashboard view registers nothing meanwhile (its explicit visible-PID
  registration returns when **Dashboard** is selected again).
- Injection DIDs are read once when the view mounts, again when the session or the selected profile
  changes, and on **Refresh**: `session.readExtended(did)` one by one, decoded by each DID's
  `decode`; `null` when the ECU gives no answer. Failures log `source: 'live-data/sensors'`
  (warning). Live-data updates re-render the view but do **not** re-read the DIDs (the injection
  list is memoised on the profile), so a poll sweep never adds five Mode 22 requests on the
  half-duplex adapter. Each read takes a run id: a newer read (session / profile change or
  **Refresh**) or leaving the view supersedes it, and the superseded read sends no further DID
  request and never sets state.

## hooks

- `useLiveData(pids?)` (`hooks/useLiveData.ts`) — subscribes to the shared live snapshot
  (`values`, `polling`) and, while mounted, **registers the screen's PID interest** on
  `liveDataStore` via `acquire(id, pids)`; unmounting releases it. With `pids` it registers exactly
  that set (the Dashboard passes its visible items plus the fuel-economy PIDs); without it, the
  **effective PID set** `session.effectivePids(profile.supportedPids)` — the ECU's supported-PID
  bitmap intersected with the profile list (for `generic`, just what the ECU reports). It does not
  spawn a poll loop of its own, and there is no service layer in this slice.

## model

- `liveDataStore` (`src/shared/state/liveDataStore.ts` since the plan 14 review — so the Extended
  PIDs screen can register DID keys without a feature → feature import; `model/liveDataStore.ts`
  re-exports it. Zustand, not persisted):
  - `values: Record<string, LiveValue>`, where `LiveValue` is `{ pid, name, unit, value, ts }`
    from `DiagnosticSession`;
  - `polling: boolean`;
  - `registrations: Record<string, string[]>`, the PID interest per subscriber id;
  - `setValues`, `setPolling`, `acquire(id, pids)` (returns an idempotent release) and
    `release(id)`.

  EngineHost writes `values` and `polling`; screens only read them.

- `dashboardLayoutStore` (`model/dashboardLayoutStore.ts`, persisted as `bolid.dashboard-layout`,
  version 1): per-profile **Customize** overrides — an explicit order and a hidden set keyed by a
  stable item id; a profile with none shows its fuel preset. The ordering / visibility math is pure
  in `model/dashboardLayout.ts` (`orderItems`, `visibleItems`, `moveInOrder`, `toggleInSet`,
  `presetFor`), unit-tested.

## Behavior

- **The single poll loop lives in the app-wide `EngineHost`** (mounted once in `_layout.tsx`, see
  [engine-host](./engine-host.md)), not in this feature. It polls the demand-driven union of: PIDs
  registered by mounted screens, PIDs enabled alert rules reference, and (while recording) the trip
  PID set. Exactly one sweep per interval
  (`pollIntervalMs` from settings) regardless of how many screens are mounted; an empty union with
  no recording idles with no bus traffic. Timing is period-not-gap (the sweep's elapsed time is
  subtracted from the interval), so a slow **K-line** sweep that exceeds the interval simply runs
  back to back and the bus sets the pace.
- Each sweep is `session.pollOnce(pids)`: on **CAN** Mode 01 PIDs are batched up to six per request
  (a chunk that cannot be parsed falls back to one-by-one reads); on K-line every PID is read
  singly.
- Only PIDs the ECU reports as supported are polled (the effective PID set). A PID that gives no
  answer in a sweep is simply absent from that sweep's snapshot; it is not dropped from later
  sweeps.

## Acceptance

- Live → **All sensors** shows the grouped cards; in the simulator (Golf) the Injection section
  lists the five Golf DIDs with values, on the Passat (K-line) the "not available here" card and
  no Mode 22 request. `/sensor-readings` no longer exists and More has no entry for it.
- A new petrol garage car with no saved layout leads the dashboard with the fuel trims; a diesel
  leads with boost.
- Dashboard values are metric (km/h, °C, km, L/100km): no conversion layer exists.

- Against the simulator, shows realistic idle values for each example car (e.g. Golf RPM ~820).
- Only renders PIDs the (simulated or real) ECU reports as supported.
- Remains responsive on a slow (K-line) link.

## Tests

- `model/dashboardLayout.test.ts` — `presetFor`: diesel lists `010B` before `0106`, petrol leads
  with `0106` / `0107` (LPG = petrol), hybrid puts `0142` first, an unknown fuel is `EMPTY_LAYOUT`;
  every supported item stays visible.
- `ui/DashboardScreen.test.tsx` — not connected; metric gauges; the **All sensors** segment shows
  the grouped view and registers exactly the effective PID set; a petrol garage car with no saved
  layout leads with the fuel trims; plan 21: a 1280 dp window renders `live-left` (the gauges) and
  `live-right` (the cards, and the Customize list), a 760 × 360 landscape phone is two-pane too, a
  640 × 360 one sizes `live-left` from the row (266 dp, two 150 dp cards); a measured 672 dp row
  (800 × 600 with a rail) gives a 302 dp gauge column and two 172 dp cards, a 290 dp card column one
  full-width card, a 454 dp one two per row on expanded and an 854 dp one three; with every gauge
  hidden and no fuel economy `live-left` is gone and the cards span the row; a 390 dp phone renders
  neither. Plan 20: at font scale 2 a phone's cards are full width and a tablet's card column holds
  one card (352 dp of a 672 dp row), at 1.3 the 150 dp minimum stays; the Customize icon buttons are
  found by role and name (**Move RPM up** disabled, **Hide RPM** → **Show RPM**). `model/twoPaneGrid.test.ts` covers the pure column / card-width maths.
- `ui/SensorGroups.test.tsx` — simulated Golf: the five injection DIDs are read once on mount
  (`readExtended` × 5) and live-data updates send no more; a read superseded by **Refresh**, or by
  leaving the view, sends nothing more; `22:<DID>` values never appear under "Other".
