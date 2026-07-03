import { decodeIupr } from './iupr';

const item = (n: number) => [Math.floor(n / 256), n % 256];

describe('IUPR decode', () => {
  it('decodes a compression-ignition (diesel) report with ratios', () => {
    const data = [
      0x49, 0x0b, 0x10,
      ...item(1500), ...item(1800), // OBDCOND, IGNCNTR
      ...item(300), ...item(400), // NMHC catalyst
      ...item(250), ...item(400), // NOx catalyst
      ...item(0), ...item(0), // NOx adsorber (not fitted)
      ...item(120), ...item(140), // PM filter
      ...item(400), ...item(410), // Exhaust gas sensor
      ...item(390), ...item(400), // EGR/VVT
      ...item(380), ...item(400), // Boost
    ];
    const r = decodeIupr(data);
    expect(r?.variant).toBe('compression');
    expect(r?.obdConditions).toBe(1500);
    expect(r?.ignitionCycles).toBe(1800);
    expect(r?.monitors[0]).toEqual({ name: 'NMHC catalyst', completions: 300, conditions: 400, ratio: 0.75 });
    expect(r?.monitors[2].ratio).toBeNull(); // 0/0 guarded
    expect(r?.monitors[6].name).toBe('Boost pressure');
  });

  it('decodes a spark report and rejects foreign bytes', () => {
    const data = [0x49, 0x08, 0x08, ...item(900), ...item(1000), ...item(400), ...item(500)];
    const r = decodeIupr(data);
    expect(r?.variant).toBe('spark');
    expect(r?.monitors[0].name).toBe('Catalyst bank 1');
    expect(r?.monitors[0].ratio).toBe(0.8);
    expect(decodeIupr([0x49, 0x02, 0x01])).toBeNull();
    expect(decodeIupr([0x41, 0x08])).toBeNull();
  });
});
