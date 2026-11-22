/** The dev mock AI server (plan 19, plan 34a Task 8): with the agent action schema it plays a
 *  scripted conversation chosen from the request line of the first user message, one turn per
 *  assistant message so far; without it the canned report and follow-up answers are unchanged. */
import type { AgentStep, AiChatMessage } from '@/shared/obd-core';
import { AGENT_ACTION_SCHEMA_NAME, parseAgentFinal } from '@/shared/obd-core';
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
