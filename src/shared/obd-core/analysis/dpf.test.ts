import { assessDpf } from './dpf';

describe('DPF assessment', () => {
  it('reports a healthy filter at low soot', () => {
    expect(assessDpf({ sootPct: 30 }).status).toBe('ok');
  });

  it('flags a regen as due at high soot', () => {
    expect(assessDpf({ sootPct: 75, kmSinceRegen: 620 }).status).toBe('regen-due');
  });

  it('flags very high soot load', () => {
    const r = assessDpf({ sootPct: 95 });
    expect(r.status).toBe('high');
    expect(r.advice).toMatch(/forced|regeneration/i);
  });

  it('detects an active regeneration from the flag', () => {
    expect(assessDpf({ regenActive: true, sootPct: 60 }).status).toBe('regenerating');
  });

  it('infers regeneration from a high exhaust temperature', () => {
    expect(assessDpf({ egtC: 560, sootPct: 50 }).status).toBe('regenerating');
  });

  it('returns unknown without a soot reading', () => {
    expect(assessDpf({}).status).toBe('unknown');
  });

  it('surfaces ash, regen count and distance as flags', () => {
    const r = assessDpf({ sootPct: 40, ashMassG: 22.5, regenCount: 312, kmSinceRegen: 410 });
    expect(r.flags.join(' ')).toMatch(/Ash load/);
    expect(r.flags.join(' ')).toMatch(/312 lifetime regenerations/);
    expect(r.flags.join(' ')).toMatch(/410 km since last regen/);
  });
});
