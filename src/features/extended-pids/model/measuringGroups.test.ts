import { findLabelPack } from '@/shared/labels';
import { getVehicleProfile } from '@/shared/vehicles';
import { resolveEnginePartNumber, resolveMeasuringGroups } from './measuringGroups';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const punto = getVehicleProfile('fiat-punto-2008-12');

describe('resolveMeasuringGroups', () => {
  it('resolves the Golf pack groups against the profile DIDs', () => {
    const groups = resolveMeasuringGroups(findLabelPack('03L906022LM'), golf.extendedPids ?? []);
    expect(groups.map((g) => g.no)).toEqual(['075', '099', '120']);
    const dpf = groups[0];
    expect(dpf.entries.map((e) => e.did)).toEqual(['1701', '1702', '1704', '1705']);
    expect(dpf.entries[0].label).toBe('DPF soot mass (calculated)'); // pack label wins
    expect(dpf.entries[0].unit).toBe('g');
    expect(dpf.defs).toHaveLength(4);
    // 170A has no pack label: the profile's name is used.
    const egr = groups.find((g) => g.no === '120');
    expect(egr?.entries.find((e) => e.did === '170A')?.label).toBe('Injector correction cyl 1');
  });

  it('marks a DID the profile does not declare as having no definition', () => {
    const groups = resolveMeasuringGroups(findLabelPack('03L906022LM'), []);
    expect(groups[0].entries.every((e) => e.def === null)).toBe(true);
    expect(groups[0].defs).toEqual([]);
    expect(groups[0].entries[0].label).toBe('DPF soot mass (calculated)');
  });

  it('is empty without a pack', () => {
    expect(resolveMeasuringGroups(null, golf.extendedPids ?? [])).toEqual([]);
  });
});

describe('resolveEnginePartNumber', () => {
  it('prefers the part number read from the car', () => {
    expect(resolveEnginePartNumber('03L906022XX', golf, true)).toBe('03L906022XX');
  });

  it("falls back to the engine module's sampleIdent only in the simulator", () => {
    expect(resolveEnginePartNumber(undefined, golf, true)).toBe('03L906022LM');
    expect(resolveEnginePartNumber(undefined, golf, false)).toBeNull();
  });

  it('is null for a profile without an engine ident', () => {
    expect(resolveEnginePartNumber(undefined, punto, true)).toBeNull();
  });
});
