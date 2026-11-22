import { FLAP_WINDOW_MS, MAX_DROPS_PER_WINDOW, pruneDrops, shouldAutoReconnect } from './flapGuard';

describe('flapGuard', () => {
  const t0 = 1_000_000;

  it('allows the first two drops in a minute and pauses on the third', () => {
    expect(MAX_DROPS_PER_WINDOW).toBe(3);
    expect(shouldAutoReconnect([t0], t0)).toBe(true);
    expect(shouldAutoReconnect([t0, t0 + 10_000], t0 + 10_000)).toBe(true);
    expect(shouldAutoReconnect([t0, t0 + 10_000, t0 + 20_000], t0 + 20_000)).toBe(false);
    expect(shouldAutoReconnect([t0, t0 + 10_000, t0 + 20_000, t0 + 30_000], t0 + 30_000)).toBe(
      false,
    );
  });

  it('prunes drops older than the window', () => {
    const drops = [t0, t0 + 10_000, t0 + 50_000];
    expect(pruneDrops(drops, t0 + FLAP_WINDOW_MS + 5_000)).toEqual([t0 + 10_000, t0 + 50_000]);
    expect(pruneDrops(drops, t0 + 10_000 + FLAP_WINDOW_MS)).toEqual([t0 + 50_000]);
    expect(pruneDrops([], t0)).toEqual([]);
  });

  it('allows reconnecting again once old drops leave the window', () => {
    const drops = [t0, t0 + 10_000, t0 + 70_001];
    // At t0+70 001 the first drop is 70 s old → only two drops in the window.
    expect(shouldAutoReconnect(drops, t0 + 70_001)).toBe(true);
  });
});
