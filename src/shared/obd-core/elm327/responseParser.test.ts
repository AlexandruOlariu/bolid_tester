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

  it('classifies DATA ERROR as a notice, not phantom hex bytes', () => {
    // "DATA ERROR" used to fall through to hex parsing, where D,A,A,E → bytes [0xDA,0xAE] (a fake
    // frame that even decodes to a phantom DTC).
    const r = parseElmResponse('DATA ERROR\r>');
    expect(r.notice).toBe('ERROR');
    expect(r.bytes).toEqual([]);
  });

  it('classifies a bare ERROR as a notice', () => {
    expect(parseElmResponse('ERROR\r>').notice).toBe('ERROR');
  });

  it('detects a K-line BUS INIT ERROR instead of an empty success', () => {
    const r = parseElmResponse('BUS INIT: ERROR\r>');
    expect(r.notice).toBe('BUS INIT ERROR');
    expect(r.bytes).toEqual([]);
  });

  it('still parses K-line data that follows a BUS INIT: OK progress line', () => {
    const r = parseElmResponse('BUS INIT: OK\r41 0C 1A F8\r>');
    expect(r.notice).toBeNull();
    expect(r.bytes).toEqual([0x41, 0x0c, 0x1a, 0xf8]);
  });

  // Multi-frame (ISO-TP) printouts — the format a REAL ELM327 uses for responses > 7 bytes.
  describe('multi-frame reassembly', () => {
    it('reassembles the datasheet VIN example (spaces on)', () => {
      const raw = '014\r0: 49 02 01 31 44 34\r1: 47 50 30 30 52 35 35\r2: 42 31 32 33 34 35 36\r\r>';
      const r = parseElmResponse(raw);
      expect(r.notice).toBeNull();
      expect(r.bytes.length).toBe(0x14);
      expect(r.bytes.slice(0, 3)).toEqual([0x49, 0x02, 0x01]);
      expect(String.fromCharCode(...r.bytes.slice(3))).toBe('1D4GP00R55B123456');
    });

    it('reassembles with spaces off (ATS0)', () => {
      const raw = '00A\r0:5902FF0104\r1:2C2F040111\r>';
      const r = parseElmResponse(raw);
      expect(r.notice).toBeNull();
      expect(r.bytes).toEqual([0x59, 0x02, 0xff, 0x01, 0x04, 0x2c, 0x2f, 0x04, 0x01, 0x11]);
    });

    it('truncates clone padding using the length line', () => {
      // 8 real bytes, last frame padded with 00s by a clone.
      const raw = '008\r0: 62 F1 87 30 33 4C\r1: 39 30 00 00 00 00 00\r>';
      const r = parseElmResponse(raw);
      expect(r.bytes.length).toBe(8);
      expect(r.bytes).toEqual([0x62, 0xf1, 0x87, 0x30, 0x33, 0x4c, 0x39, 0x30]);
    });

    it('drops interleaved response-pending echoes around a multi-frame answer', () => {
      const raw = '7F 19 78\r00A\r0: 59 02 FF 01 04 2C\r1: 2F 04 01 11 AA AA AA\r>';
      const r = parseElmResponse(raw);
      expect(r.bytes).toEqual([0x59, 0x02, 0xff, 0x01, 0x04, 0x2c, 0x2f, 0x04, 0x01, 0x11]);
    });

    it('handles a missing length line (keeps all segment bytes)', () => {
      const raw = '0: 62 F1 87 30 33 4C\r1: 39 30 36 30 32 32 42\r>';
      const r = parseElmResponse(raw);
      expect(r.bytes.slice(0, 3)).toEqual([0x62, 0xf1, 0x87]);
      expect(r.bytes.length).toBe(13);
    });

    it('leaves plain single-line responses untouched', () => {
      const r = parseElmResponse('41 0C 0C D0\r\r>');
      expect(r.bytes).toEqual([0x41, 0x0c, 0x0c, 0xd0]);
    });
  });
});
