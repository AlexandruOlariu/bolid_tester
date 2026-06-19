# bolid-tester — working notes for Claude

Generic OBD2/EOBD diagnostics app (React Native / Expo, TypeScript, Tamagui, zustand).
Documentation-driven — `docs/` is the source of truth; see `docs/architecture.md`.

## Orient before reading broadly — use the context graph

This repo ships a **`bolid-context`** skill (`.claude/skills/bolid-context/`) that
maps screens, features, obd-core modules, stores, transport, vehicles, docs, and
curated domain concepts. For any non-trivial task (find / understand / change a
feature or flow), query it **first**, then read only the files it lists:

```bash
python .claude/skills/bolid-context/scripts/graph.py context <term>   # start here
python .claude/skills/bolid-context/scripts/graph.py find <term>
python .claude/skills/bolid-context/scripts/graph.py neighbors <node-id>
```

It returns references + one-line summaries (never file contents), so it replaces
the `glob → grep → read` discovery loop. The graph auto-rebuilds on `src/`,
`docs/`, or `curated.json` edits (PostToolUse hook in `.claude/settings.json`).
Add durable domain knowledge as `concept` nodes in `graph/curated.json`.

## Layout

- `src/app/*.tsx` — expo-router route screens (thin; re-export the feature screen).
- `src/features/<slug>/` — feature slices (`ui/`, `hooks/`, `model/`), one per screen.
- `src/shared/obd-core/` — platform-agnostic engine: `transport → elm327 → obd → session`, plus `analysis/*` and `coding/*`. Unit-tested, no RN deps.
- `src/shared/{state,ui,transports/ble,ai,notify,vehicles,lib}/` — stores, components, BLE transport, services, vehicle profiles, utils.
- `docs/` — architecture, OBD2/ELM327 reference, simulator, per-feature and per-vehicle docs.
