/** Plan 09: the `$mono` token used by the sniffer, coding and module-scan screens must resolve to a
 *  font the native platform knows. Tamagui's v3 config ships a CSS fallback stack, which iOS cannot
 *  resolve, so `tamagui.config.ts` overrides it per platform. */
import { Platform } from 'react-native';
import config from '../../../tamagui.config';
import { monoFontFamily } from './monoFont';

describe('tamagui $mono font', () => {
  it('is one installed family on the native test platform, not the web stack', () => {
    expect(Platform.OS).not.toBe('web');
    const family = config.fonts.mono.family;
    expect(family).toBe(monoFontFamily(Platform.OS));
    expect(family).not.toMatch(/[,"]/);
  });

  it('keeps the rest of the mono font (sizes, line heights) from the base config', () => {
    expect(config.fonts.mono.size).toBeTruthy();
    expect(config.fonts.body.family).toBeTruthy();
  });
});
