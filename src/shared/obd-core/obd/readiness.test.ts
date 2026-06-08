import { decodeMonitorStatus } from './readiness';

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
