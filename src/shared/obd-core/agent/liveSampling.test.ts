import type { LiveValue } from '../session/DiagnosticSession';
import { LIVE_SAMPLE_MS, liveSampleNotes, parseLivePids, sampleLivePids } from './liveSampling';
import type { ToolContext } from './types';

function fakeCtx(answers: Record<string, LiveValue>, supported: string[]) {
  let t = 0;
  let polls = 0;
  const ctx = {
    session: {
      effectivePids: () => supported,
      pollOnce: async (pids: string[]) => {
        polls += 1;
        return Object.fromEntries(pids.filter((p) => answers[p]).map((p) => [p, answers[p]]));
      },
    },
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    signal: new AbortController().signal,
  } as unknown as ToolContext;
  return { ctx, polls: () => polls, clock: () => t };
}

const rpm: LiveValue = { pid: '010C', name: 'Engine RPM', value: 820, unit: 'rpm' } as LiveValue;

describe('parseLivePids', () => {
  it('upper-cases, de-duplicates and drops non-strings, keeping request order', () =>
    expect(parseLivePids(['010c', 5, '0105', '010C'])).toEqual(['010C', '0105']));

  it('reads a missing or non-array argument as no PIDs', () => {
    expect(parseLivePids(undefined)).toEqual([]);
    expect(parseLivePids('010C')).toEqual([]);
  });
});

describe('sampleLivePids', () => {
  it('polls once for 0 s and splits answered, silent and unsupported PIDs', async () => {
    const f = fakeCtx({ '010C': rpm }, ['010C', '0105']);
    const s = await sampleLivePids(f.ctx, ['010C', '0105', '0106'], 0);
    expect(f.polls()).toBe(1);
    expect(f.clock()).toBe(0);
    expect(s.pids).toEqual(['010C', '0105']);
    expect(s.unsupported).toEqual(['0106']);
    expect(s.silent).toEqual(['0105']);
    expect(s.series).toEqual([{ pid: '010C', meta: rpm, values: [820] }]);
    expect(liveSampleNotes(s)).toEqual([
      'No answer from the car: 0105.',
      'Not supported on this car: 0106.',
    ]);
  });

  it('polls once per tick over the window', async () => {
    const f = fakeCtx({ '010C': rpm }, ['010C']);
    const s = await sampleLivePids(f.ctx, ['010C'], 2);
    expect(f.polls()).toBe(4);
    expect(f.clock()).toBe(3 * LIVE_SAMPLE_MS);
    expect(s.series[0].values).toEqual([820, 820, 820, 820]);
  });

  it('does not poll when nothing supported was requested', async () => {
    const f = fakeCtx({}, ['010C']);
    const s = await sampleLivePids(f.ctx, [], 5);
    expect(f.polls()).toBe(0);
    expect(liveSampleNotes(s)).toEqual(['No PIDs requested.']);
  });
});
