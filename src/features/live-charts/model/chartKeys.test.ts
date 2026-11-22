import { chartKeyOptions, panelLabels } from './chartKeys';
import { getVehicleProfile } from '@/shared/vehicles';

const golfDefs = getVehicleProfile('golf-plus-2009-20tdi').extendedPids ?? [];

describe('chartKeyOptions', () => {
  it('lists Mode 01 PIDs then the extended keys on CAN', () => {
    const opts = chartKeyOptions(['010C', '0105'], golfDefs, true);
    expect(opts.slice(0, 2).map((o) => o.label)).toEqual(['Engine RPM (rpm)', 'Coolant temp (°C)']);
    const soot = opts.find((o) => o.key === '22:1701');
    expect(soot).toEqual({
      key: '22:1701',
      label: 'DPF soot mass (calc.) (g) · 1701',
      extended: true,
    });
    expect(opts.filter((o) => o.extended)).toHaveLength(golfDefs.length);
  });

  it('offers no extended keys off CAN or without DIDs', () => {
    expect(chartKeyOptions(['010C'], golfDefs, false).map((o) => o.key)).toEqual(['010C']);
    expect(chartKeyOptions(['010C'], [], true).map((o) => o.key)).toEqual(['010C']);
  });
});

describe('panelLabels', () => {
  it('labels a mixed panel, with a DID fallback for an undeclared key', () => {
    expect(panelLabels(['010C', '22:1702', '22:FFFF'], golfDefs)).toEqual({
      '010C': 'Engine RPM (rpm)',
      '22:1702': 'DPF soot load (%) · 1702',
      '22:FFFF': 'DID FFFF',
    });
  });
});
