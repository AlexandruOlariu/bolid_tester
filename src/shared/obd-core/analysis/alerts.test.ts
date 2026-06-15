import { AlertEngine, AlertRule, defaultRules } from './alerts';

const coolant: AlertRule = {
  id: 'coolant',
  pid: '0105',
  op: 'gt',
  value: 110,
  hysteresis: 5,
  severity: 'critical',
};

describe('AlertEngine', () => {
  it('fires on crossing and clears only past the hysteresis margin', () => {
    const e = new AlertEngine();
    expect(e.evaluate([coolant], { '0105': { value: 100 } }).fired).toHaveLength(0);

    const cross = e.evaluate([coolant], { '0105': { value: 115 } });
    expect(cross.fired).toHaveLength(1);
    expect(cross.fired[0].severity).toBe('critical');

    // 108 is below the 110 threshold but within hysteresis (>105) → stays active.
    expect(e.evaluate([coolant], { '0105': { value: 108 } }).cleared).toHaveLength(0);
    expect(e.current).toHaveLength(1);

    // 104 is past the hysteresis margin → clears.
    const clear = e.evaluate([coolant], { '0105': { value: 104 } });
    expect(clear.cleared).toHaveLength(1);
    expect(e.current).toHaveLength(0);
  });

  it('does not re-fire while continuously active', () => {
    const e = new AlertEngine();
    e.evaluate([coolant], { '0105': { value: 120 } });
    const again = e.evaluate([coolant], { '0105': { value: 121 } });
    expect(again.fired).toHaveLength(0);
    expect(again.active).toHaveLength(1);
  });

  it('clears alerts when a rule is disabled or removed', () => {
    const e = new AlertEngine();
    e.evaluate([coolant], { '0105': { value: 120 } });
    const off = e.evaluate([{ ...coolant, enabled: false }], { '0105': { value: 120 } });
    expect(off.cleared).toHaveLength(1);
  });

  it('supports plain-number snapshots and outside-range rules', () => {
    const e = new AlertEngine();
    const rule: AlertRule = { id: 'v', pid: '0142', op: 'outside', value: 12, value2: 14.8, severity: 'warn' };
    expect(e.evaluate([rule], { '0142': 13 }).fired).toHaveLength(0);
    expect(e.evaluate([rule], { '0142': 11 }).fired).toHaveLength(1);
  });

  it('seeds sensible default rules from the effective PID set', () => {
    const rules = defaultRules(['0105', '0142', '010C']);
    expect(rules.map((r) => r.id)).toEqual(['coolant-hot', 'low-voltage', 'over-rev']);
    expect(defaultRules([])).toHaveLength(0);
  });
});
