# Plan 34d — AI diagnostic agent: trail in History, privacy, Send to Claude / ChatGPT, i18n and docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save each agent run's trail with its History entry, tell the user exactly what the agent sends (privacy policy, store answers, one line on the AI page), let them hand a report to their own Claude / ChatGPT app through the share sheet (VIN off by default), and finish the docs, translations review and context graph for the whole agent.

**Architecture:** `AiHistoryEntry` gains an optional, bounded `trail` (history store v3, old entries open unchanged) that `AiReportView` renders read-only. The share package is a pure English text builder in `src/shared/lib/agentShare.ts` (files leaving the phone stay English, per `docs/i18n.md`) behind a preview sheet with an **Include VIN** switch. No network call is added.

**Tech Stack:** zustand persist (`bolid.history`), React Native `Share`, Tamagui, i18next, Jest.

**Spec:** [`docs/superpowers/specs/2026-11-22-ai-agent-diagnose-design.md`](../superpowers/specs/2026-11-22-ai-agent-diagnose-design.md) — "Screen" (trail saved in History), "Safety and limits → Privacy", "Send to Claude / ChatGPT".

**Depends on:** [34a](./34a-ai-agent-core.md). The privacy wording covers the data kinds added by [34b](./34b-ai-agent-capability-skills.md) and [34c](./34c-ai-agent-playbooks.md); land it after them, or with them if they ship together.

## Global Constraints

- **Read-only agent in this phase**; nothing here adds a tool or a write path. **Clear codes** stays the existing confirmed button.
- Never immobilizer / airbag / cluster-mileage; never ship seed/key algorithms.
- Metric only.
- Every user-facing string en + ro in the same task; the share package text itself is English (a document that leaves the phone); "Claude" and "ChatGPT" are brand names, untranslated.
- Privacy: data goes only to the provider the user configured; the policy and `privacyPolicy.ts` stay word-for-word in step (`privacyPolicy.test.ts`); bump `PRIVACY_POLICY_UPDATED` and the doc's "Last updated" together. The share package leaves out the VIN unless the user turns it on in the preview.
- Persistence: `bolid.history` goes to `version: 3` with a `migrate` step; it is already in `PERSISTED_STORES`; never persist secrets.
- No new network destination (share sheet only).
- `npm run ci` green at the end of every task; `act()` warnings fixed in tests only. Never touch `.agents/`, `.codex/`, `AGENTS.md`; never commit keystores, `.env`, `android/`. Commit messages end with the executing session's attribution lines.

## Review Focus

- **An AI history entry saved before this plan (no trail)** → opens exactly as today, no empty trail header. (Task 1 test.)
- **A long run (13 steps, large digests)** → the stored trail is bounded (16 steps, 600 characters per digest), the history file does not balloon. (Task 1 test.)
- **The VIN appears inside a digest** (triage prints `VIN: …`, the identity tool prints it) → with **Include VIN** off it is gone from the whole package, not just the header. (Task 3 test.)
- **The share sheet is dismissed or `Share.share` rejects** → nothing breaks; a rejection goes to `logError`. (Task 3 test.)
- **A backup made before this plan is restored** → history v2 migrates to v3 and every entry survives. (Task 1 test.)

## Read first

`src/shared/state/historyStore.ts` (+ test), `src/features/history/ui/HistoryScreen.tsx`, `src/features/ai-diagnose/ui/{AiReportView,AgentTrail,AiDiagnoseScreen}.tsx` (after 34a), `src/features/ai-diagnose/hooks/useAiDiagnose.ts`, `docs/privacy-policy.md`, `src/features/settings/model/privacyPolicy.ts` (+ test), `store/compliance/{play-data-safety,apple-privacy}.md`, `src/features/settings/ui/AiSettingsScreen.tsx`, `src/shared/lib/scrub.ts` (`findVins`, `maskKnownVins`), `docs/i18n.md`, `docs/features/{ai-diagnose,history,settings}.md`, `docs/architecture.md`.

---

### Task 1: Save the trail with the AI run in History

**Files:**

- Modify: `src/shared/state/historyStore.ts`, `src/features/ai-diagnose/hooks/useAiDiagnose.ts` (pass `trail`, `request`, `end` to `addAiRun`), `src/features/ai-diagnose/ui/AgentTrail.tsx` (accept `ReadonlyArray<TrailRow>`), `src/features/ai-diagnose/ui/AiReportView.tsx` (optional `trail` prop → collapsed read-only `AgentTrail`), `src/features/history/ui/HistoryScreen.tsx` (pass the entry's `trail`), `docs/features/history.md`
- Test: `src/shared/state/historyStore.test.ts`, `src/features/history/ui/HistoryScreen.test.tsx`

**Interfaces:**

- Consumes: `AgentStep`, `AgentRunRequest`, `AgentEnd` (34a).
- Produces:

```ts
export const MAX_STORED_TRAIL_STEPS = 16;
export const MAX_STORED_DIGEST_CHARS = 600;
export type TrailRow = Pick<
  AgentStep,
  'id' | 'kind' | 'tool' | 'why' | 'digest' | 'summary' | 'label' | 'status' | 'unconfirmed'
>;
export function toStoredTrail(trail: readonly AgentStep[]): TrailRow[]; // first 16 steps, digests cut to 600 chars + '…', findings dropped
// AiHistoryEntry gains: trail?: TrailRow[]; request?: AgentRunRequest; end?: AgentEnd
```

`addAiRun` stores `toStoredTrail(trail)`; persist `version: 3`; `migrate` from v2 returns the entries unchanged (v1 → v2 step kept).

- [ ] **Step 1: Write the failing tests**

```ts
it('stores a bounded trail', () => {
  const trail = Array.from({ length: 20 }, (_, i) => step(i + 1, { digest: 'x'.repeat(2000), findings: [{ key: 'k', severity: 'warn' }] }));
  useHistoryStore.getState().addAiRun({ ...aiRunBase, trail: toStoredTrail(trail) });
  const e = useHistoryStore.getState().entries[0] as AiHistoryEntry;
  expect(e.trail).toHaveLength(16); expect(e.trail![0].digest.length).toBeLessThanOrEqual(601);
  expect('findings' in e.trail![0]).toBe(false);
});
it('migrates a v2 file to v3 keeping every entry', async () => {
  writePersisted('bolid.history', { entries: [oldAiEntryWithoutTrail, dtcEntry] }, 2);
  await useHistoryStore.persist.rehydrate();
  expect(useHistoryStore.getState().entries).toHaveLength(2);
  expect(readPersisted('bolid.history').version).toBe(3);
});
// HistoryScreen.test.tsx
it('re-opens a run with its trail; an old run without one shows no trail', async () => {
  seedHistory([aiEntryWithTrail, oldAiEntryWithoutTrail]);
  renderWithProviders(<HistoryScreen />);
  await openEntry(aiEntryWithTrail); expect(screen.getByText(/Triage — /)).toBeTruthy();
  await openEntry(oldAiEntryWithoutTrail); expect(screen.queryByText(/Triage — /)).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/state/historyStore.test.ts` and `npx jest --selectProjects ui src/features/history` → FAIL.
- [ ] **Step 3: Implement**; `storeVersions.test.ts` passes (explicit version ≥ 1). Add one line to `docs/features/history.md` ("an AI run re-opens with its investigation trail; runs saved before plan 34d have none").
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(history): save the agent trail with each AI run"`

---

### Task 2: Privacy policy, store answers and the "what is sent" line

**Files:**

- Modify: `docs/privacy-policy.md`, `src/features/settings/model/privacyPolicy.ts` (same paragraphs; `PRIVACY_POLICY_UPDATED` = the date this lands), `src/features/settings/model/privacyPolicy.test.ts`, `store/compliance/play-data-safety.md`, `store/compliance/apple-privacy.md` (their AI-assistant sections), `src/features/settings/ui/AiSettingsScreen.tsx`, `src/shared/i18n/locales/{en,ro}/settings.json`, `docs/features/settings.md`
- Test: `src/features/settings/model/privacyPolicy.test.ts`, `src/features/settings/ui/AiSettingsScreen.test.tsx` (extend or create)

**Interfaces:**

- Produces:
  - The policy's AI paragraph (both files, verbatim):
    "AI assistant: off until you set up a provider. When you pick one (your own local server, OpenAI, Anthropic or another server you enter), each diagnosis, each investigation step and each follow-up question sends that provider what the app has read for it: fault codes and their descriptions, readiness monitors, the freeze frame, live values and short recordings, the vehicle make, model and engine, the VIN, the car’s known checks for those codes and, when the investigation reads them, control-module part numbers, software versions and fault codes, manufacturer readings (extended data, adaptation and coding values, DPF values), recorded trip values, fuel-economy and performance-test results, the maintenance log, past diagnoses and fault-code checks from History, your alert rules, recent app error messages (with VINs and addresses removed), adapter details, and your answers to the on-screen driver steps, plus your question and the earlier answers. It goes only to the provider you chose. A local server stays on your network; a cloud provider (OpenAI or Anthropic) receives it over the internet and handles it under its own privacy policy and terms. API keys are kept in the phone’s secure storage, one per provider, never in backups, and each is sent only to its own provider."
  - A new "Sharing and exports" paragraph (both files, verbatim): "Send to Claude / ChatGPT: on an AI report, this builds a plain-text summary of the report, the fault codes and every check the investigation made, shows it to you first, and hands it to the app you pick in the share sheet, for example the official Claude or ChatGPT app. The VIN is left out unless you turn on Include VIN in that preview. The app sends nothing itself."
  - Technical notes (doc only): the agent's requests are built by `buildAgentMessages` / `buildAgentFollowUpMessages` (`src/shared/obd-core/agent/prompt.ts`) from tool digests (`src/shared/obd-core/agent/`, `src/features/*/agent/`) and sent by `src/shared/ai`; the share package is `buildAgentSharePackage` (`src/shared/lib/agentShare.ts`), with no network call.
  - AI settings page, under the enable switch while the assistant is on: `settings:ai.whatIsSent` en "Sent to the provider you choose: fault codes, live and recorded readings, module and manufacturer data, trips, maintenance, history, the VIN and your answers. Details in Settings → About → Privacy policy." (+ ro).

- [ ] **Step 1: Write the failing tests**

```ts
it('the AI paragraph lists what the agent sends (plan 34d)', () => {
  const ai = PRIVACY_POLICY.flatMap((s) => s.paragraphs).find((p) => p.startsWith('AI assistant:'))!;
  for (const w of ['each investigation step', 'part numbers', 'recorded trip values', 'the maintenance log',
    'past diagnoses', 'recent app error messages', 'your answers to the on-screen driver steps']) expect(ai).toContain(w);
});
it('describes Send to Claude / ChatGPT and the VIN switch', () => {
  const all = PRIVACY_POLICY.flatMap((s) => s.paragraphs).join(' ');
  expect(all).toContain('Send to Claude / ChatGPT'); expect(all).toContain('The VIN is left out unless you turn on Include VIN');
});
// AiSettingsScreen.test.tsx
it('shows what is sent while the assistant is on', () => {
  useSettingsStore.setState((s) => ({ ai: { ...s.ai, enabled: true } }));
  renderWithProviders(<AiSettingsScreen />);
  expect(screen.getByText(/Sent to the provider you choose/)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/features/settings/model/privacyPolicy.test.ts` and `npx jest --selectProjects ui src/features/settings` → FAIL.
- [ ] **Step 3: Implement**; the existing policy tests (same headings, verbatim paragraphs, date, every network destination named) keep passing; update the two store-compliance AI sections with the same list of data kinds.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "docs(privacy): what the AI agent sends; the AI page says it in one line"`

---

### Task 3: Send to Claude / ChatGPT

**Files:**

- Create: `src/shared/lib/agentShare.ts`, `src/features/ai-diagnose/ui/SharePackageSheet.tsx`
- Modify: `src/features/ai-diagnose/ui/AiDiagnoseScreen.tsx` (a **Send to Claude / ChatGPT** button under the report's actions), `src/shared/i18n/locales/{en,ro}/aiDiagnose.json`, `docs/features/ai-diagnose.md`
- Test: `src/shared/lib/agentShare.test.ts` (core), `src/features/ai-diagnose/ui/AiDiagnoseScreen.test.tsx`

**Interfaces:**

- Consumes: `TrailRow` (Task 1), `AiReport`, `Dtc`, `findVins`, `maskKnownVins` (`src/shared/lib/scrub.ts`).
- Produces:

```ts
export const SHARE_PACKAGE_MAX_CHARS = 20_000;
export const VIN_HIDDEN = '[VIN hidden]';
export interface AgentShareInput {
  vehicleLabel: string;
  vin: string | null;
  generatedAt: number;
  report: AiReport;
  dtcs: { stored: Dtc[]; pending: Dtc[]; permanent: Dtc[] };
  trail: readonly TrailRow[];
  request: AgentRunRequest | null;
}
export function buildAgentSharePackage(
  input: AgentShareInput,
  opts: { includeVin: boolean },
): string;
```

Text layout (English, plain): an instruction header — "I used the Bolid Tester app to read my car over OBD2. Below is everything it read and what its assistant concluded. Please explain the most likely causes, how sure we can be, and what I should check next. You cannot ask the app for new readings; tell me what to check and I will report back." — then `Vehicle:` (label, VIN line only when included), `Complaint:` (the symptom, "Check everything" or the focus code), `Fault codes:` (stored / pending / permanent with descriptions), `Assistant report:` (overall, summary, each finding with severity, detail, "based on steps …", "(unconfirmed data)"), `Checks made:` (each step `Step N — <tool or Triage> — <why>` + its digest), and the report's disclaimer. With `includeVin: false`, every occurrence of `input.vin` and every `findVins(text)` match in the **whole** text becomes `[VIN hidden]` and the `VIN:` line is omitted. Output clamped to 20 000 characters with a final `… (cut to fit)` line.

`SharePackageSheet({ input, onClose })`: a scrollable, selectable preview of the package, a `LabeledSwitch` **Include VIN** (default off; the preview re-renders), **Share** → `Share.share({ message, title: t('share.title') })`; a rejection goes to `logError({ source: 'ai-diagnose', error, severity: 'warning', context: { phase: 'share' } })`; dismissing the sheet is a no-op.

- [ ] **Step 1: Write the failing tests**

```ts
const vin = 'WVWZZZ1KZ9W903398';
it('leaves the VIN out everywhere by default', () => {
  const text = buildAgentSharePackage(
    { ...input, vin, trail: [row(1, { digest: `VIN: ${vin}\nStored DTCs (1): P0401` })] },
    { includeVin: false },
  );
  expect(text).not.toContain(vin);
  expect(text).toContain('[VIN hidden]');
  expect(text).not.toMatch(/^VIN:/m);
});
it('includes the VIN when switched on', () =>
  expect(buildAgentSharePackage({ ...input, vin }, { includeVin: true })).toContain(`VIN: ${vin}`));
it('carries the codes, the findings with their steps and every check', () => {
  const t = buildAgentSharePackage(inputWithReport, { includeVin: false });
  expect(t).toContain('P0401');
  expect(t).toContain('based on steps 1, 2');
  expect(t).toContain('Step 2 — read_live —');
});
it('is clamped', () =>
  expect(buildAgentSharePackage(hugeInput, { includeVin: false }).length).toBeLessThanOrEqual(
    20_000,
  ));
// AiDiagnoseScreen.test.tsx
it('Send to Claude / ChatGPT previews without the VIN and shares', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await runMockReport();
  fireEvent.press(screen.getByText('Send to Claude / ChatGPT'));
  expect(screen.queryByText(/WVWZZZ1KZ9W903398/)).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByText('Share'));
  });
  expect(share.mock.calls[0][0].message).toContain('[VIN hidden]');
});
it('a failing share sheet is logged, not thrown', async () => {
  jest.spyOn(Share, 'share').mockRejectedValue(new Error('no app'));
  await runMockReport();
  fireEvent.press(screen.getByText('Send to Claude / ChatGPT'));
  await act(async () => {
    fireEvent.press(screen.getByText('Share'));
  });
  expect(useErrorLogStore.getState().errors[0]).toMatchObject({ source: 'ai-diagnose' });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest --selectProjects core src/shared/lib/agentShare.test.ts` and `npx jest --selectProjects ui src/features/ai-diagnose` → FAIL.
- [ ] **Step 3: Implement** the builder, the sheet and the button; strings `share.button` ("Send to Claude / ChatGPT"), `share.title`, `share.includeVin` ("Include VIN"), `share.includeVinHint` ("Off by default. Turn on only if you want the other app to see it."), `share.preview`, `share.send` ("Share") in en + ro; a "Send to Claude / ChatGPT" subsection in `docs/features/ai-diagnose.md`.
- [ ] **Step 4: Run, then `npm run ci`** → PASS / green.
- [ ] **Step 5: Commit** — `git commit -m "feat(ai-diagnose): Send to Claude / ChatGPT through the share sheet, VIN off by default"`

---

### Task 4: Translation completeness for the agent

**Files:**

- Create: `src/features/ai-diagnose/agentStrings.test.ts` (core)
- Modify: `docs/i18n.md` (agent keys and the model-facing boundary: skill documents, digests, prompts and the share package stay English; tool labels, driver instructions and choices, finding titles / details and notices are translated; the agent copy added to **Owner review**), any missing key the test finds in `src/shared/i18n/locales/{en,ro}/*.json`
- Test: `src/features/ai-diagnose/agentStrings.test.ts`

**Interfaces:**

- Consumes: every agent contribution (import the feature `agentTools` modules and `PLAYBOOK_CONTRIBUTION` directly — a test, not product code), `CORE_AGENT_CONTRIBUTION`, `DRIVER_INSTRUCTIONS`, `i18n.exists`.
- Produces: assertions only.

- [ ] **Step 1: Write the test**

```ts
// FEATURE_AGENT_TOOLS: every src/features/*/agent/agentTools.ts `agentTools`, imported by path
const contributions = [CORE_AGENT_CONTRIBUTION, PLAYBOOK_CONTRIBUTION, ...FEATURE_AGENT_TOOLS];
it.each(['en', 'ro'])('every tool label exists in %s', (lng) => {
  for (const c of contributions)
    for (const t of c.tools ?? []) expect(i18n.exists(t.labelKey, { lng })).toBe(true);
});
it.each(['en', 'ro'])('every driver instruction and choice exists in %s', (lng) => {
  for (const [id, d] of Object.entries(DRIVER_INSTRUCTIONS)) {
    expect(i18n.exists(d.labelKey, { lng })).toBe(true);
    for (const c of d.choices ?? [])
      expect(i18n.exists(`aiDiagnose:agent.driver.choice.${c}`, { lng })).toBe(true);
    expect(id).toMatch(/^[a-z_0-9]+$/);
  }
});
it.each(['en', 'ro'])('every end notice exists in %s', (lng) => {
  for (const e of [
    'no_ai',
    'no_ai_symptom',
    'steps',
    'time',
    'adapter',
    'invalid',
    'stopped',
    'disconnected',
    'ai_error',
  ])
    expect(i18n.exists(`aiDiagnose:agent.end.${e}`, { lng })).toBe(true);
});
it.each(['en', 'ro'])('every core finding key has a title and detail in %s', (lng) => {
  for (const k of CORE_FINDING_KEYS) {
    expect(i18n.exists(`${k}.title`, { lng })).toBe(true);
    expect(i18n.exists(`${k}.detail`, { lng })).toBe(true);
  }
});
```

`CORE_FINDING_KEYS` in the test: `battery.{good,fair,weak,unknown}`, `charging.{weakUnderLoad,ok}`, `trims.{ok,lean,rich,vacuum_leak,lean_all_speeds,insufficient}`, `boost.{ok,idle_high,stuck_vnt,map_below_baro,no_boost_hold,overboost_hold,stuck_sensor,hold_not_reached,insufficient}`, `cooling.{ok,hot_now,overheat_now,thermostat_open,slow_warmup,trip_overheat,no_cold_trip}`, `misfire.{none,cylinder,random,no_data}`, each prefixed `aiDiagnose:agent.finding.`.

- [ ] **Step 2: Run** — `npx jest --selectProjects core src/features/ai-diagnose/agentStrings.test.ts`; expected PASS if 34a–34c added every key, otherwise FAIL naming the missing key.
- [ ] **Step 3: Add any missing en + ro key; update `docs/i18n.md`.**
- [ ] **Step 4: `npm run ci`** → green (`i18nParity.test.ts` included).
- [ ] **Step 5: Commit** — `git commit -m "test(i18n): every agent label, driver step, notice and finding is translated"`

---

### Task 5: Docs, implementation log, roadmap and the context graph

**Files:**

- Modify: `docs/features/ai-diagnose.md` (rewrite top to bottom: intro now "investigates step by step"; Scope & safety (read-only facade, allowlist, excluded modules, Clear codes stays a button, stationary driver steps); UI (symptom field, Investigate / Check everything, trail, Stop, driver prompt, cited findings, unconfirmed tag, Re-run, Clear codes → triage only, follow-ups over the trail, Send to Claude / ChatGPT); The loop and its budget (exact values); Tools and skills (core vs feature-owned rule, `bolid.skill.v1`, progressive disclosure, the 21 capability skills and 17 playbooks tables); Without AI; Experimental data; Privacy; Mock AI scripts; Simulator faults; Eval set; Layers; Acceptance), `docs/architecture.md` (an "AI agent" paragraph: registry and loop in `src/shared/obd-core/agent`, features contribute through `src/app/ai-diagnose.tsx` — not a fifth composition point), `docs/implementation-log.md` (entry "AI agent: history, privacy, share (plan 34d)" plus a one-paragraph summary of 34a–34d), `docs/roadmap.md` (an "AI diagnostic agent" row, ✅ with "on-car pending: boost ranges, eval against the owner's model"), `.claude/skills/bolid-context/graph/curated.json` (concept `concept:ai-agent`: "Read-only multi-step AI diagnosis: triage → JSON actions over a tool/skill registry (core tools + feature agentTools composed in src/app/ai-diagnose.tsx) → cited report; budget 12 steps / 4 min; rule-report fallback; bolid.skill.v1 skills with open_skill / run_skill", linked to `feature:ai-diagnose`, `core:analysis/aiDiagnosis`, the spec doc and the four plans)
- Test: `npm run ci` (`featureDocsSync`), graph build

- [ ] **Step 1: Write the docs** (every value copied from the plans as shipped; no new behaviour).
- [ ] **Step 2: Rebuild and query the graph** — `PYTHONIOENCODING=utf-8 python .claude/skills/bolid-context/scripts/graph.py build`, then `… graph.py context ai-agent`; expected: the concept node listed with its links.
- [ ] **Step 3: `npm run format` on the touched docs, then `npm run ci`** → green.
- [ ] **Step 4: Commit** — `git commit -m "docs: the AI diagnostic agent end to end; roadmap, log and graph concept"`

---

## Acceptance

- [ ] An agent run re-opens from History with its trail; older runs open as before.
- [ ] Settings → About → Privacy policy and `docs/privacy-policy.md` list everything the agent sends and the share flow; the AI page shows the one-line summary.
- [ ] **Send to Claude / ChatGPT** opens a preview without the VIN; **Include VIN** adds it; **Share** opens the system share sheet with the text.
- [ ] `npm run ci` green; graph rebuilt.

## Deferred until an on-car session

Owner actions, none blocking the code:

1. **Review the Romanian agent copy** (`locales/ro/aiDiagnose.json` → `agent.*`, the feature `agent.*` keys, `settings.json` → `ai.whatIsSent`), especially the driver instructions and the stationary warning, as listed in `docs/i18n.md` → Owner review.
2. **Real hand-off to Claude and ChatGPT.** After a run on the Golf, tap **Send to Claude / ChatGPT**, share into the official Claude app and the ChatGPT app on the phone; confirm the text arrives whole (no truncation by the receiving app) and that the answer engages with the checks. If an app truncates, lower `SHARE_PACKAGE_MAX_CHARS` and note the limit in `docs/features/ai-diagnose.md`.
3. **Store listings.** Update the Google Play data-safety form and the App Store privacy answers from the revised `store/compliance/*.md` before the next release that ships the agent.
