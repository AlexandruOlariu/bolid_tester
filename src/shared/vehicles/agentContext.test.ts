import { knownChecksFor, toVehicleContext } from './agentContext';
import { getVehicleProfile, vehicleLabel } from './index';

describe('toVehicleContext', () => {
  it('carries the profile notes and a fixed expected protocol to the model', () => {
    const golf = getVehicleProfile('golf-plus-2009-20tdi');
    const ctx = toVehicleContext(golf);
    expect(ctx.label).toBe(vehicleLabel(golf));
    expect(ctx.make).toBe(golf.make);
    expect(ctx.expectedProtocol).toBe('ISO_15765_4_CAN_11_500');
    expect(ctx.notes).toBe(golf.notes);
    expect(ctx.notes).toBeTruthy();
  });

  it('leaves out the AUTO protocol for the generic profile', () => {
    const ctx = toVehicleContext(getVehicleProfile('generic'));
    expect(ctx.label).toBe('Auto / Generic OBD2');
    expect(ctx.expectedProtocol).toBeUndefined();
  });
});

describe('knownChecksFor', () => {
  it('lists one entry per curated guide and skips codes that only hit the generic guide', () => {
    const checks = knownChecksFor('golf-plus-2009-20tdi', ['P2183', 'P2015', 'P0420']);
    expect(checks.map((c) => c.code)).toEqual(['P2183', 'P2015']);
    expect(checks.every((c) => c.note.length > 0)).toBe(true);
  });

  it('returns nothing for a car without curated guides', () => {
    expect(knownChecksFor('generic', ['P2183'])).toEqual([]);
  });
});
