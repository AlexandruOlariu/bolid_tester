import palette from '../ui/palette.json';
import {
  checkPalette,
  contrastRatio,
  failures,
  parseHex,
  relativeLuminance,
  type Palette,
} from './contrast';

const PALETTE = palette as Palette;

/** A deep copy of the shipped palette with one change, for the failure cases. */
function withChange(change: (p: Palette) => void): Palette {
  const copy = JSON.parse(JSON.stringify(PALETTE)) as Palette;
  change(copy);
  return copy;
}

describe('contrastRatio (WCAG 2.1)', () => {
  it('matches the reference values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#0D1117')).toBeCloseTo(18.9, 1);
    expect(contrastRatio('#2bb673', '#FFFFFF')).toBeCloseTo(2.61, 2);
    expect(contrastRatio('#8B949E', '#0D1117')).toBeCloseTo(6.15, 2);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
  });

  it('is symmetric and accepts #RGB', () => {
    expect(contrastRatio('#0D1117', '#2bb673')).toBe(contrastRatio('#2bb673', '#0D1117'));
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(parseHex('#0f0')).toEqual([0, 255, 0]);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('rejects a colour that is not hex', () => {
    expect(() => contrastRatio('green', '#000')).toThrow(/Not a hex colour/);
    expect(() => parseHex('#12345')).toThrow();
  });
});

describe('checkPalette (src/shared/ui/palette.json)', () => {
  it('every token of the shipped palette passes in both themes', () => {
    const checks = checkPalette(PALETTE);
    expect(failures(checks)).toEqual([]);
    // Text tokens × surfaces, graphic tokens × surfaces, onFill × fills, plus the splash pair.
    expect(checks.length).toBeGreaterThan(40);
    expect(checks.some((c) => c.pair === 'light.text.accent on #FFFFFF')).toBe(true);
    expect(checks.some((c) => c.pair === 'brand.ink on brand.green')).toBe(true);
  });

  it('fails when a light token is flipped to the dark-theme green', () => {
    const bad = withChange((p) => {
      p.themes.light.text.accent = '#2bb673';
    });
    const failed = failures(checkPalette(bad)).map((c) => c.pair);
    expect(failed).toContain('light.text.accent on #FFFFFF');
    expect(failed).toContain('light.onFill on light.text.accent');
  });

  it('holds graphics to 3:1 and the splash title to 4.5:1', () => {
    const bad = withChange((p) => {
      p.themes.dark.graphic.gaugeTrack = '#30363D'; // 1.55 on #0D1117
      p.brand.ink = '#FFFFFF'; // white on the brand green: 2.61
    });
    const failed = failures(checkPalette(bad));
    expect(failed.map((c) => c.pair)).toEqual(
      expect.arrayContaining(['dark.graphic.gaugeTrack on #0D1117', 'brand.ink on brand.green']),
    );
    expect(failed.find((c) => c.pair.startsWith('dark.graphic'))?.min).toBe(3);
  });

  it('does not ask onFill text to sit on the placeholder colour', () => {
    expect(
      checkPalette(PALETTE).some((c) => c.pair.includes('onFill on dark.text.placeholderColor')),
    ).toBe(false);
  });
});
