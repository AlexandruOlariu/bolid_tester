import { decodeMonitorStatus, diffReadiness, Monitor, MonitorStatus } from './readiness';

describe('monitor status (PID 0101)', () => {
  it('decodes MIL, DTC count, ignition type and monitors', () => {
    const s = decodeMonitorStatus([0x83, 0x07, 0x21, 0x01]);
    expect(s.milOn).toBe(true);
    expect(s.dtcCount).toBe(3);
    expect(s.ignition).toBe('spark');
    expect(s.monitors.find((m) => m.id === 'misfire')?.complete).toBe(true);

    const catalyst = s.monitors.find((m) => m.name === 'Catalyst');
    expect(catalyst?.supported).toBe(true);
    expect(catalyst?.complete).toBe(false); // D bit 0 set → incomplete

    expect(s.monitors.find((m) => m.name === 'Oxygen sensor')?.complete).toBe(true);
  });

  it('detects compression ignition (diesel)', () => {
    const s = decodeMonitorStatus([0x00, 0x0f, 0x00, 0x00]);
    expect(s.ignition).toBe('compression'); // B bit 3 set
    expect(s.milOn).toBe(false);
    expect(s.dtcCount).toBe(0);
  });
});

describe('diffReadiness (coach edge detection)', () => {
  const mon = (id: string, complete: boolean, supported = true): Monitor => ({
    id,
    name: id,
    supported,
    complete,
  });
  const status = (monitors: Monitor[]): MonitorStatus => ({
    milOn: false,
    dtcCount: 0,
    ignition: 'compression',
    monitors,
  });

  it('reports nothing on the first sample (baseline)', () => {
    const d = diffReadiness(null, status([mon('catalyst', false)]));
    expect(d.becameReady).toEqual([]);
    expect(d.becameAllReady).toBe(false);
  });

  it('lists monitors that flipped incomplete → complete', () => {
    const prev = status([mon('catalyst', false), mon('egr', false)]);
    const next = status([mon('catalyst', true), mon('egr', false)]);
    const d = diffReadiness(prev, next);
    expect(d.becameReady.map((m) => m.id)).toEqual(['catalyst']);
    expect(d.becameAllReady).toBe(false); // egr still incomplete
  });

  it('flags becameAllReady only when the last incomplete monitor completes', () => {
    const prev = status([mon('catalyst', true), mon('egr', false)]);
    const next = status([mon('catalyst', true), mon('egr', true)]);
    const d = diffReadiness(prev, next);
    expect(d.becameReady.map((m) => m.id)).toEqual(['egr']);
    expect(d.becameAllReady).toBe(true);
  });

  it('does not re-fire once everything is already ready', () => {
    const all = status([mon('catalyst', true), mon('egr', true)]);
    const d = diffReadiness(all, all);
    expect(d.becameReady).toEqual([]);
    expect(d.becameAllReady).toBe(false);
  });

  it('ignores unsupported monitors and monitors absent from prev', () => {
    const prev = status([mon('catalyst', false)]);
    const next = status([mon('catalyst', true), mon('egr', true), mon('o2', true, false)]);
    const d = diffReadiness(prev, next);
    expect(d.becameReady.map((m) => m.id)).toEqual(['catalyst']); // egr/o2 not in prev-incomplete
    expect(d.becameAllReady).toBe(true);
  });
});
