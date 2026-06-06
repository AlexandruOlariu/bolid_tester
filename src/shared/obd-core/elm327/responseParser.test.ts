import { parseElmResponse } from './responseParser';

describe('parseElmResponse', () => {
  it('parses hex data', () => {
    const r = parseElmResponse('41 0C 0C D0\r\r>');
    expect(r.notice).toBeNull();
    expect(r.bytes).toEqual([0x41, 0x0c, 0x0c, 0xd0]);
  });

  it('detects NO DATA', () => {
    expect(parseElmResponse('NO DATA\r\r>').notice).toBe('NO DATA');
  });

  it('strips a SEARCHING... prefix before the data', () => {
    const r = parseElmResponse('SEARCHING...\r41 00 BE 3F A8 13\r>');
    expect(r.notice).toBeNull();
    expect(r.bytes.slice(0, 2)).toEqual([0x41, 0x00]);
  });

  it('detects the unknown-command marker', () => {
    expect(parseElmResponse('?\r>').notice).toBe('?');
  });

  it('treats OK as empty data (no notice)', () => {
    const r = parseElmResponse('OK\r>');
    expect(r.notice).toBeNull();
    expect(r.bytes).toEqual([]);
  });
});
