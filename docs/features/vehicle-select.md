# Feature: vehicle-select

Choose which vehicle profile to use (or **Auto / Generic**).

## UI
- **VehicleListScreen** — cards for each registered profile (the 3 example cars) plus a prominent
  **Auto / Generic OBD2** entry. Shows expected protocol and a short description per card.

## hooks
- `useVehicleProfiles()` — list profiles from the registry.
- `useSelectedVehicle()` — get/set the active profile in the store.

## api (service layer)
- Reads from `src/shared/vehicles` (the typed registry). No device I/O.

## model
- `vehicleStore` (Zustand): `selectedProfileId` (defaults to `generic`).

## Behavior
- Selecting a profile sets `selectedProfileId`. The live-data dashboard and extended-PIDs feature use
  it to decide which PIDs to show and whether extended reads are offered.
- The **generic** profile shows everything the car's supported-PID bitmap reports.
- The active profile is a **hint**: the adapter still auto-detects the real protocol, and the runtime
  bitmap still governs which PIDs actually appear.

## Acceptance
- Always offers Auto/Generic.
- Switching profiles updates the dashboard's PID set without reconnecting.
