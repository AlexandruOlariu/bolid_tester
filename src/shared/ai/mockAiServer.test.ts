/** The dev mock AI server (plan 19, plan 34a Task 8, plan 34c Task 8): with the agent action schema it plays a
 *  scripted conversation chosen from the request line of the first user message, one turn per
 *  assistant message so far; without it the canned report and follow-up answers are unchanged. */
import type { AgentStep, AiChatMessage, BoostInput } from '@/shared/obd-core';
import { AGENT_ACTION_SCHEMA_NAME, assessBoost, parseAgentFinal } from '@/shared/obd-core';
import { createMockAiClient } from './__mocks__/mockAiServer';

const sys: AiChatMessage = { role: 'system', content: 'You are an agent.' };
const user = (content: string): AiChatMessage => ({ role: 'user', content });
const asst = (content: string): AiChatMessage => ({ role: 'assistant', content });

const agent = { schema: { name: 'bolid_agent_action', schema: {} } };

/** The parsed reply at turn `turns` (that many assistant messages before it). */
async function turn(first: AiChatMessage[], turns: number) {
  const messages = [...first];
  for (let i = 0; i < turns; i++) messages.push(asst('{}'), user(`Step ${i + 2} result: ok`));
  const reply = await createMockAiClient().chat(messages, agent);
  return JSON.parse(reply!) as Record<string, unknown>;
}

describe('mock AI server — agent scripts', () => {
  it('uses the agent schema name the loop sends', () =>
    expect(agent.schema.name).toBe(AGENT_ACTION_SCHEMA_NAME));

  it('default script reads live data then cites triage and the read', async () => {
    const c = createMockAiClient();
    const first = [
      sys,
      user('Stored DTCs (1): P0401 — EGR\nCheck everything: there is no specific complaint.'),
    ];
    expect(JSON.parse((await c.chat(first, agent))!)).toMatchObject({ tool: 'read_live' });
    const final = JSON.parse(
      (await c.chat([...first, asst('{}'), user('Step 2 result: ok')], agent))!,
    ).final;
    expect(final.summary).toBe('Mock AI report: 1 fault code(s) to look at.');
    expect(final.findings[0]).toMatchObject({ codes: ['P0401'], steps: [1] });
  });

  it('the default read asks for rpm, coolant and module voltage once', async () =>
    expect(await turn([sys, user('Check everything: there is no specific complaint.')], 0)).toEqual(
      {
        tool: 'read_live',
        args: { pids: ['010C', '0105', '0142'], seconds: 0 },
        why: expect.any(String),
      },
    ));

  it('the default final has one warn finding per code plus the idle reading', async () => {
    const first = [
      sys,
      user(
        'Vehicle: Golf\n\nStep 1 (triage):\nStored DTCs (2): P0401, P2015\n\nCheck everything: there is no specific complaint.',
      ),
    ];
    const { final } = (await turn(first, 1)) as {
      final: { summary: string; findings: Record<string, unknown>[] };
    };
    expect(final.summary).toBe('Mock AI report: 2 fault code(s) to look at.');
    expect(final.findings).toHaveLength(3);
    expect(final.findings[0]).toMatchObject({ severity: 'warn', codes: ['P0401'], steps: [1] });
    expect(final.findings[1]).toMatchObject({ severity: 'warn', codes: ['P2015'], steps: [1] });
    expect(final.findings[2]).toMatchObject({
      title: 'Idle readings look normal (mock)',
      severity: 'ok',
      steps: [2],
    });
  });

  it('the default final counts only codes in the first user message', async () => {
    const first = [sys, user('Check everything: there is no specific complaint.')];
    const messages = [...first, asst('{}'), user('Step 2 result: P0300 seen')];
    const { final } = JSON.parse((await createMockAiClient().chat(messages, agent))!) as {
      final: { summary: string; findings: Record<string, unknown>[] };
    };
    expect(final.summary).toBe('Mock AI report: nothing to flag.');
    expect(final.findings).toEqual([
      expect.objectContaining({ title: 'Idle readings look normal (mock)', steps: [2] }),
    ]);
  });

  it('a focus run follows the default script', async () =>
    expect(
      await turn(
        [
          sys,
          user(
            'The driver asks about fault code P0401: explain it, likely causes, and what to check.',
          ),
        ],
        0,
      ),
    ).toMatchObject({ tool: 'read_live' }));

  it('a battery symptom opens then runs the battery skill', async () => {
    const c = createMockAiClient();
    const m = [sys, user('The driver reports: "battery dies overnight"')];
    expect(JSON.parse((await c.chat(m, agent))!)).toEqual({
      tool: 'open_skill',
      args: { name: 'battery' },
      why: expect.any(String),
    });
    expect(JSON.parse((await c.chat([...m, asst('{}'), user('r')], agent))!).tool).toBe(
      'run_skill',
    );
  });

  it('the battery script runs the skill by name and finishes citing triage and the run', async () => {
    const first = [sys, user('The driver reports: "BATTERY dies overnight"')];
    expect(await turn(first, 1)).toEqual({
      tool: 'run_skill',
      args: { name: 'battery' },
      why: expect.any(String),
    });
    const { final } = (await turn(first, 2)) as {
      final: { summary: string; findings: { steps: number[] }[] };
    };
    expect(final.summary).toEqual(expect.any(String));
    expect(final.findings.length).toBeGreaterThan(0);
    for (const f of final.findings) expect(f.steps).toEqual([1, 3]);
  });

  it('the Romanian word for battery picks the battery script too', async () =>
    expect(
      await turn([sys, user('The driver reports: "Baterie descărcată dimineața"')], 0),
    ).toMatchObject({ tool: 'open_skill', args: { name: 'battery' } }));

  it('a battery reading in the triage digest does not pick the battery script', async () =>
    expect(
      await turn(
        [
          sys,
          user(
            'Step 1 (triage):\nBattery 12.4 V\n\nCheck everything: there is no specific complaint.',
          ),
        ],
        0,
      ),
    ).toMatchObject({ tool: 'read_live' }));

  it('the scripted finals pass the loop citation check with every finding kept', async () => {
    const step = (id: number): AgentStep => ({
      id,
      kind: id === 1 ? 'triage' : 'tool',
      why: '',
      digest: 'ok',
      summary: 'ok',
      label: { key: 'k' },
      status: 'ok',
      durationMs: 0,
    });
    const trail = [step(1), step(2), step(3)];
    const everything = (await turn(
      [sys, user('Stored DTCs (1): P0401\n\nCheck everything: there is no specific complaint.')],
      1,
    )) as { final: { findings: unknown[] } };
    const battery = (await turn([sys, user('The driver reports: "battery dies"')], 2)) as {
      final: { findings: unknown[] };
    };
    for (const { final } of [everything, battery]) {
      const report = parseAgentFinal(final, trail);
      expect(report?.findings).toHaveLength(final.findings.length);
      expect(report?.uncitedDropped).toBeUndefined();
    }
  });

  it('a "pulls weak" symptom opens and runs the boost playbook', async () => {
    const c = createMockAiClient();
    const m = [sys, user('The driver reports: "pulls weak above 2000 rpm"')];
    expect(JSON.parse((await c.chat(m, agent))!)).toMatchObject({
      tool: 'open_skill',
      args: { name: 'boost' },
    });
    expect(JSON.parse((await c.chat([...m, asst('{}'), user('r')], agent))!)).toMatchObject({
      tool: 'run_skill',
      args: { name: 'boost' },
    });
  });

  it('"boost" and "turbo" pick the boost script too, in any case', async () => {
    for (const symptom of ['Low BOOST when overtaking', 'turbo whistles then nothing'])
      expect(await turn([sys, user(`The driver reports: ${JSON.stringify(symptom)}`)], 0)).toEqual({
        tool: 'open_skill',
        args: { name: 'boost' },
        why: expect.any(String),
      });
  });

  /** The boost conversation up to the final: triage, the opened skill document (step 2, whose text
   *  names every verdict) and the step-3 digest the boost procedure wrote. */
  const boostFinal = async (digest: string) => {
    const messages = [
      sys,
      user('Vehicle: Golf\n\nStep 1 (triage):\nNo codes\n\nThe driver reports: "pulls weak"'),
      asst('{}'),
      user('Step 2 result:\nboost skill: stuck VNT, overboost, rev hold not reached, MAP sensor'),
      asst('{}'),
      user(`Step 3 result:\n${digest}\n\nReply with your next action (step 4 of 12).`),
    ];
    const reply = await createMockAiClient().chat(messages, agent);
    return (JSON.parse(reply!) as { final: Record<string, unknown> }).final as {
      overall: string;
      summary: string;
      findings: { title: string; severity: string; steps: number[] }[];
    };
  };

  /** A step-3 digest built from the boost analysis' own notes, as the boost procedure writes it. */
  const boostDigest = (input: Partial<BoostInput>): string =>
    assessBoost(
      {
        idleMapKpa: 102,
        idleRpm: 800,
        holdMapKpa: null,
        holdMaxRpm: null,
        baroKpa: 101,
        ...input,
      },
      { idleDeltaKpa: [-5, 15], holdDeltaKpa: [8, 60], holdRpm: 2500, minHoldRpm: 2200 },
    ).notes.join('\n');

  it('the boost final has one finding per verdict in the step-3 digest, citing triage and the run', async () => {
    const final = await boostFinal(boostDigest({ holdMapKpa: 104, holdMaxRpm: 2500 }));
    expect(final.summary).toMatch(/^Mock AI report/);
    expect(final.overall).toBe('attention');
    expect(final.findings).toEqual([
      expect.objectContaining({
        title: 'Boost check: no_boost_hold (mock)',
        severity: 'warn',
        steps: [1, 3],
      }),
    ]);
    const step = (id: number): AgentStep => ({
      id,
      kind: id === 1 ? 'triage' : 'skill',
      why: '',
      digest: 'ok',
      summary: 'ok',
      label: { key: 'k' },
      status: 'ok',
      durationMs: 0,
    });
    const report = parseAgentFinal(final, [step(1), step(2), step(3)]);
    expect(report?.findings).toHaveLength(1);
    expect(report?.uncitedDropped).toBeUndefined();
  });

  it('reads two verdicts from one digest, and none from the skill document', async () => {
    const final = await boostFinal(
      boostDigest({ idleMapKpa: 140, holdMapKpa: 141, holdMaxRpm: 1900 }),
    );
    expect(final.findings.map((f) => f.title)).toEqual([
      'Boost check: stuck_vnt (mock)',
      'Boost check: hold_not_reached (mock)',
    ]);
  });

  it('a judged digest with no fault reads as ok', async () => {
    const final = await boostFinal(boostDigest({ holdMapKpa: 135, holdMaxRpm: 2500 }));
    expect(final.overall).toBe('ok');
    expect(final.findings).toEqual([
      expect.objectContaining({ title: 'Boost check: ok (mock)', severity: 'ok', steps: [1, 3] }),
    ]);
  });

  it('a digest that judged nothing gives no boost finding', async () => {
    const final = await boostFinal(
      'Boost (MAP 010B minus baro 0133).\n010B not answered: boost not judged.',
    );
    expect(final.summary).toMatch(/^Mock AI report/);
    expect(final.findings).toEqual([]);
  });

  it('mock:invalid never sends JSON', async () =>
    expect(
      await createMockAiClient().chat([sys, user('The driver reports: "mock:invalid"')], agent),
    ).toBe('not json'));

  it('mock:invalid stays invalid on later turns', async () => {
    const m = [sys, user('The driver reports: "mock:invalid"'), asst('not json'), user('Invalid')];
    expect(await createMockAiClient().chat(m, agent)).toBe('not json');
  });

  it('mock:loop reads rpm on every turn', async () => {
    const first = [sys, user('The driver reports: "mock:loop"')];
    for (const n of [0, 1, 5, 11])
      expect(await turn(first, n)).toEqual({
        tool: 'read_live',
        args: { pids: ['010C'] },
        why: expect.any(String),
      });
  });
});

describe('mock AI server — without the agent schema', () => {
  const report = [sys, user('Stored DTCs (1): P0401 — EGR')];

  it('still answers a diagnosis with the canned report', async () => {
    const parsed = JSON.parse((await createMockAiClient().chat(report))!) as {
      summary: string;
      findings: { codes: string[] }[];
    };
    expect(parsed.summary).toBe('Mock AI report: 1 fault code(s) to look at.');
    expect(parsed.findings[0].codes).toEqual(['P0401']);
  });

  it('still answers a battery symptom with the canned report under another schema', async () => {
    const parsed = JSON.parse(
      (await createMockAiClient().chat([sys, user('The driver reports: "battery dies"')], {
        schema: { name: 'bolid_report', schema: {} },
      }))!,
    ) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('tool');
    expect(parsed.summary).toBe('Mock AI report: nothing to flag.');
  });

  it('still answers a follow-up in plain text', async () => {
    const answer = await createMockAiClient().chat(
      [...report, asst('{}'), user('Is it safe to drive?')],
      { json: false },
    );
    expect(answer).toMatch(/^Mock answer 1: you asked "Is it safe to drive\?"/);
  });
});
