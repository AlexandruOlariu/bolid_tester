import type { DiscoveredModule } from '@/shared/obd-core';
import { getVehicleProfile } from '@/shared/vehicles';
import { diagModuleLiteral, discoveredToModule, isInModuleList } from './discovery';

const hvac: DiscoveredModule = {
  candidate: { address: '08', name: 'Auto HVAC', reqHeader: '746', rxFilter: '7B0' },
  ident: { partNumber: "1K0907044'X", raw: { F187: "1K0907044'X", F197: 'Climatronic' } },
  state: 'answered',
  ms: 12,
};

describe('module discovery helpers', () => {
  it('turns a discovered candidate into an experimental UDS module', () => {
    expect(discoveredToModule(hvac)).toEqual({
      address: '08',
      name: 'Auto HVAC',
      transport: 'uds',
      reqHeader: '746',
      rxFilter: '7B0',
      experimental: true,
    });
  });

  it('knows when the car already lists the id pair', () => {
    const golf = getVehicleProfile('golf-plus-2009-20tdi').modules ?? [];
    expect(isInModuleList(hvac, golf)).toBe(false);
    const engine = {
      ...hvac,
      candidate: { address: '01', name: 'Engine', reqHeader: '7e0', rxFilter: '7E8' },
    };
    expect(isInModuleList(engine, golf)).toBe(true);
  });

  it('renders a pasteable literal with the read ident, quotes escaped', () => {
    const text = diagModuleLiteral(hvac);
    expect(text).toContain("reqHeader: '746',");
    expect(text).toContain("sampleIdent: { F187: '1K0907044\\'X', F197: 'Climatronic' },");
    expect(text).toContain('experimental: true,');
    expect(text).toMatch(/confirmed: \{ on: 'YYYY-MM-DD'/);
    expect(diagModuleLiteral({ ...hvac, ident: null })).not.toContain('sampleIdent');
  });
});
