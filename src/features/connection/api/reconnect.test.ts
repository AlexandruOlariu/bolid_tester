import { runReconnect, RECONNECT_DELAYS_MS, ReconnectDeps } from './reconnect';

/** A deps stub whose sleep resolves immediately and records the requested delays. */
function makeDeps(over: Partial<ReconnectDeps> = {}): ReconnectDeps & { delays: number[]; attempts: number[] } {
  const delays: number[] = [];
  const attempts: number[] = [];
  return {
    delays,
    attempts,
    sleep: async (ms) => {
      delays.push(ms);
    },
    isAborted: () => false,
    onAttempt: (n) => attempts.push(n),
    attemptConnect: async () => false,
    ...over,
  };
}

describe('runReconnect', () => {
  it('waits the 2s/5s/10s backoff and gives up after 3 failed attempts', async () => {
    const deps = makeDeps();
    const ok = await runReconnect(deps);
    expect(ok).toBe(false);
    expect(deps.delays).toEqual([...RECONNECT_DELAYS_MS]);
    expect(deps.attempts).toEqual([1, 2, 3]);
  });

  it('stops at the first successful attempt', async () => {
    let calls = 0;
    const deps = makeDeps({
      attemptConnect: async () => {
        calls++;
        return calls === 2; // succeed on the 2nd attempt
      },
    });
    const ok = await runReconnect(deps);
    expect(ok).toBe(true);
    expect(calls).toBe(2);
    expect(deps.delays).toEqual([2000, 5000]); // only two backoff waits before success
    expect(deps.attempts).toEqual([1, 2]);
  });

  it('aborts before attempting when cancelled during the backoff wait', async () => {
    let aborted = false;
    let connectCalls = 0;
    const deps = makeDeps({
      sleep: async () => {
        aborted = true; // manual disconnect lands during the wait
      },
      isAborted: () => aborted,
      attemptConnect: async () => {
        connectCalls++;
        return true;
      },
    });
    const ok = await runReconnect(deps);
    expect(ok).toBe(false);
    expect(connectCalls).toBe(0); // never attempted a connect after the abort
  });

  it('treats a thrown attempt as a failure and keeps going', async () => {
    let calls = 0;
    const deps = makeDeps({
      attemptConnect: async () => {
        calls++;
        if (calls < 3) throw new Error('still no adapter');
        return true;
      },
    });
    const ok = await runReconnect(deps);
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });
});
