import { WEB_MONO_STACK, monoFontFamily } from './monoFont';

describe('monoFontFamily (plan 09)', () => {
  it('names one installed family on iOS and Android — never a CSS stack', () => {
    expect(monoFontFamily('ios')).toBe('Menlo');
    expect(monoFontFamily('android')).toBe('monospace');
    for (const os of ['ios', 'android']) {
      expect(monoFontFamily(os)).not.toMatch(/[,"]/);
    }
  });

  it('keeps the browser fallback stack on web', () => {
    expect(monoFontFamily('web')).toBe(WEB_MONO_STACK);
    expect(WEB_MONO_STACK).toMatch(/monospace$/);
  });
});
