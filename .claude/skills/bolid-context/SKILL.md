---
name: bolid-context
description: >-
  Use at the START of any non-trivial task touching the bolid-tester repo —
  finding, understanding, or changing a feature, screen, OBD-core module, store,
  BLE transport, vehicle profile, or doc. Loads ONLY the relevant files via a
  precomputed project graph instead of grepping/reading broadly. Run
  scripts/graph.py context <term> to get a compact context pack, then read just
  the listed files. Also covers: rebuilding the graph after structural changes
  and registering domain concepts. Trigger on "where is", "how does X work",
  "add/change feature", "trace the flow", or before broad code exploration.
---

# bolid-tester context graph

A token-light map of this repo. **Orient with one query, then read only the
files it points to** — don't fan out with `grep`/`glob`/broad reads first.

The graph returns *references + one-line summaries, never file contents*. The
graph JSON itself is not meant to be read into context — only the query output.

## Use it first

```bash
python3 .claude/skills/bolid-context/scripts/graph.py context <term>
# (on Windows: python .\.claude\skills\bolid-context\scripts\graph.py context <term>)
```

Example: `... context dpf regeneration` → returns the concept, the `feature:dpf`
slice, `screen:dpf`, `core:analysis/dpf` (+ its test), and `docs/features/dpf.md`.
Then open just those files.

## Commands

- `context <term...>` — ranked, grouped context pack for a task/feature/term. **Start here.**
- `find <term...>` — list nodes matching a term (id, path, summary).
- `neighbors <node-id>` — direct relations of a node (imports / serves / documents / relates).
- `docs <term...>` — docs + concepts related to a term.
- `stats` — node/edge counts and the biggest hubs.
- `build` — regenerate `graph/nodes.json` + `graph/edges.json` from `src/` + `docs/` + `curated.json`.

Node ids look like `feature:dpf`, `screen:faults`, `core:elm327/Elm327Client`,
`store:sessionStore`, `transport:BleTransport`, `vehicle:registry`,
`doc:architecture`, `concept:connection-lifecycle`.

## How the graph is built

- **Structural (auto-derived from code):** screens (`src/app/*.tsx`), features
  (`src/features/*`), obd-core modules (`src/shared/obd-core/**`), stores, ui,
  transport, services, vehicles, and docs. Edges: `serves` (screen→feature),
  `imports` (resolved through the `@/` alias and the obd-core/ui/vehicles
  barrels), `documents` (doc↔code by name), `named` (slug match). Co-located
  `*.test.ts` files are attached to their module as `tests:` metadata.
- **Curated (`graph/curated.json`, hand-edited):** `concept` nodes and `relates`
  links — domain knowledge structure can't express (the connection lifecycle,
  the OBD request pipeline, DPF regen, ECU coding, etc.). **This is the durable
  payoff — add a concept here once instead of re-explaining it every session.**

## Keeping it fresh

The graph **auto-rebuilds** via a `PostToolUse` hook
(`scripts/refresh-hook.py`, registered in `.claude/settings.json`) whenever a
file under `src/`, `docs/`, or `curated.json` changes. Build takes <1s. If the
graph ever looks stale, just run `build`.

## Adding a domain concept

Edit `graph/curated.json` → add to `concepts[]` (id, summary, tokens) and wire
it with `links[]` (`["concept:<id>", "<node-id>", "relates"]`). Use
`graph.py find <term>` to get exact node ids. Rebuild (or let the hook do it).

## Tuning signal-to-noise

Four knobs at the top of the query section in `scripts/graph.py`:
`KIND_WEIGHT` (per-relation conductance), `HUB_DEGREE` (don't expand through
hubs), `RELEVANCE_FLOOR` (drop weak matches), `GROUP_CAP` (max per group). If
packs are noisy, raise the floor / lower `HUB_DEGREE`; if they miss obvious
files, add a `relates` link in `curated.json`.
