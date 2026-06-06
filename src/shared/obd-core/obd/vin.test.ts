import { parseVin } from './vin';
import { asciiToBytes } from '../../lib/bytes';

describe('VIN assembly', () => {
  it('assembles a single-frame VIN', () => {
    const vin = 'WVWZZZ1KZ9W000001';
    const bytes = [0x49, 0x02, 0x01, ...asciiToBytes(vin)];
    expect(parseVin(bytes)).toBe(vin);
  });

  it('ignores repeated 49 02 markers and frame/count bytes', () => {
    const vin = '1HGBH41JXMN109186';
    const bytes = [
      0x49,
      0x02,
      0x01,
      ...asciiToBytes(vin.slice(0, 7)),
      0x49,
      0x02,
      0x02,
      ...asciiToBytes(vin.slice(7)),
    ];
    expect(parseVin(bytes)).toBe(vin);
  });
});
