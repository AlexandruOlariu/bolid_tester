/** Window-size classes (plan 21): the Material 3 breakpoints and the rules built on them. */
import { classify, isTwoPane, layoutInfo, railMinHeight, usesSideRail } from './layoutClass';

describe('classify', () => {
  it.each([
    [360, 'compact'],
    [599, 'compact'],
    [600, 'medium'],
    [839, 'medium'],
    [840, 'expanded'],
    [1280, 'expanded'],
  ] as const)('%d dp → %s', (width, cls) => {
    expect(classify(width)).toBe(cls);
  });
});

describe('layoutInfo', () => {
  it('marks landscape when the window is wider than tall', () => {
    expect(layoutInfo(915, 412)).toEqual({
      cls: 'expanded',
      width: 915,
      height: 412,
      landscape: true,
      fontScale: 1,
    });
    expect(layoutInfo(390, 844, 1.3)).toMatchObject({
      cls: 'compact',
      landscape: false,
      fontScale: 1.3,
    });
  });
});

describe('two-pane and side rail', () => {
  it('two-pane on anything wider than a portrait phone', () => {
    expect(isTwoPane(layoutInfo(390, 844))).toBe(false);
    expect(isTwoPane(layoutInfo(700, 1000))).toBe(true);
    expect(isTwoPane(layoutInfo(1280, 800))).toBe(true);
  });

  it('side rail on expanded, or on medium in landscape, when tall enough', () => {
    expect(usesSideRail(layoutInfo(390, 844))).toBe(false);
    expect(usesSideRail(layoutInfo(700, 1000))).toBe(false); // medium portrait: bottom bar
    expect(usesSideRail(layoutInfo(800, 600))).toBe(true); // medium landscape, tall enough
    expect(usesSideRail(layoutInfo(800, 1280))).toBe(false); // tablet portrait is medium
    expect(usesSideRail(layoutInfo(1280, 800))).toBe(true);
    expect(usesSideRail(layoutInfo(900, 1200))).toBe(true); // expanded even in portrait
  });

  it('a phone on its side keeps the bottom bar: the 7-item rail does not fit 360–430 dp', () => {
    expect(railMinHeight()).toBeGreaterThan(430);
    expect(railMinHeight()).toBeLessThanOrEqual(600); // a 7-inch tablet in landscape still fits
    expect(usesSideRail(layoutInfo(640, 360))).toBe(false); // small phone, medium + landscape
    expect(usesSideRail(layoutInfo(780, 360))).toBe(false);
    expect(usesSideRail(layoutInfo(915, 412))).toBe(false); // Pixel 7: expanded by width
    expect(usesSideRail(layoutInfo(932, 430))).toBe(false); // the tallest phones in landscape
  });

  it('larger system fonts need more height for the rail', () => {
    expect(railMinHeight(1.5)).toBeGreaterThan(railMinHeight(1));
    expect(railMinHeight(0.85)).toBe(railMinHeight(1));
    const h = railMinHeight(1) + 10;
    expect(usesSideRail(layoutInfo(1280, h, 1))).toBe(true);
    expect(usesSideRail(layoutInfo(1280, h, 1.5))).toBe(false);
  });
});
