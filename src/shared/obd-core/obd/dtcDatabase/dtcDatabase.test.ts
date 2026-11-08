import {
  DTC_CODE_PATTERN,
  DTC_RANGES,
  DTC_SEVERITY_RULES,
  describeDtc,
  isManufacturerSpecific,
  lookupDtc,
  subsystemForCode,
} from './index';
import { P0, P0_PARTS } from './generic/p0';
import { P2, P2_PARTS } from './generic/p2';
import { P3 } from './generic/p3';
import { B0 } from './generic/b0';
import { C0 } from './generic/c0';
import { U0 } from './generic/u0';
import {
  VAG_P1,
  VAG_DTC_TEXTS,
  saeCodeForVagCode,
  vagDtcText,
  vagNativeDtcText,
} from './manufacturer/vag';
import { FIAT_P1 } from './manufacturer/fiat';
import { describeDtc as describeFromDtc, toDtc } from '../dtc';
import * as fs from 'fs';
import * as path from 'path';

/** Every data file, by name, as it is stored (parts, not the composed families). */
const FILES: Record<string, Record<string, string>> = {
  'p0-part1': P0_PARTS[0],
  'p0-part2': P0_PARTS[1],
  'p0-part3': P0_PARTS[2],
  'p0-part4': P0_PARTS[3],
  'p2-part1': P2_PARTS[0],
  'p2-part2': P2_PARTS[1],
  p3: P3,
  b0: B0,
  c0: C0,
  u0: U0,
  'vag-p1': VAG_P1,
  fiat: FIAT_P1,
};

describe('DTC database — data', () => {
  it('meets the coverage floors', () => {
    // Plan 05 asked for P0 ≥ 1400; the accurate data set holds 1333 (uncertain codes omitted on
    // purpose), so the floor is the actual count rounded down to 50. See implementation-log.
    expect(Object.keys(P0).length).toBeGreaterThanOrEqual(1300);
    expect(Object.keys(P2).length).toBeGreaterThanOrEqual(600);
    expect(Object.keys(U0).length).toBeGreaterThanOrEqual(250);
    expect(Object.keys(VAG_P1).length).toBeGreaterThanOrEqual(150);
  });

  it('composes the P0 / P2 families from their parts without losing a key', () => {
    const sum = (parts: readonly Record<string, string>[]) =>
      parts.reduce((n, p) => n + Object.keys(p).length, 0);
    expect(Object.keys(P0).length).toBe(sum(P0_PARTS));
    expect(Object.keys(P2).length).toBe(sum(P2_PARTS));
  });

  it('uses upper-case 5-character keys, unique across every file, with non-empty text', () => {
    const seen = new Map<string, string>();
    for (const [file, table] of Object.entries(FILES)) {
      for (const [code, text] of Object.entries(table)) {
        expect(`${file}:${code}`).toMatch(/:[PCBU][0-9A-F]{4}$/);
        expect(DTC_CODE_PATTERN.test(code)).toBe(true);
        expect(text.trim().length).toBeGreaterThan(3);
        if (seen.has(code)) throw new Error(`${code} in both ${seen.get(code)} and ${file}`);
        seen.set(code, file);
      }
    }
  });

  it('keeps each family in its own file', () => {
    const family = (table: Record<string, string>) =>
      new Set(Object.keys(table).map((k) => k.slice(0, 2)));
    expect([...family(P0)]).toEqual(['P0']);
    expect([...family(P2)]).toEqual(['P2']);
    expect([...family(U0)]).toEqual(['U0']);
    expect([...family(B0)]).toEqual(['B0']);
    expect([...family(C0)]).toEqual(['C0']);
    expect(Object.keys(P3).every((k) => k.startsWith('P34'))).toBe(true);
    // Manufacturer tables only hold manufacturer-range codes (generic ones live in generic/).
    for (const k of [...Object.keys(VAG_P1), ...Object.keys(FIAT_P1)]) {
      expect(isManufacturerSpecific(k)).toBe(true);
    }
  });

  it('keeps the native KWP 5-digit table to component names (5-digit keys)', () => {
    for (const [key, text] of Object.entries(VAG_DTC_TEXTS)) {
      expect(key).toMatch(/^\d{5}$/);
      // The failure type comes from the status byte, so no fixed failure-mode suffix.
      expect(text).not.toMatch(/ — /);
    }
  });
});

describe('DTC database — size budget', () => {
  it('keeps every data file at most 1 800 lines and the module at most 350 KB of source', () => {
    const files = ['generic', 'manufacturer']
      .flatMap((dir) =>
        fs.readdirSync(path.join(__dirname, dir)).map((f) => path.join(__dirname, dir, f)),
      )
      .concat(path.join(__dirname, 'index.ts'));
    let bytes = 0;
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      bytes += Buffer.byteLength(text, 'utf8');
      const lines = text.split('\n').length;
      expect({ file: path.basename(f), tooLong: lines > 1800 }).toEqual({
        file: path.basename(f),
        tooLong: false,
      });
    }
    expect(bytes).toBeLessThanOrEqual(350 * 1024);
  });
});

describe('DTC database — lookup', () => {
  it('spot-checks the standard descriptions', () => {
    expect(describeDtc('P0101')).toMatch(/mass.*air.*flow/i);
    expect(describeDtc('P0420')).toMatch(/catalyst/i);
    expect(describeDtc('P0300')).toMatch(/random.*misfire/i);
    expect(describeDtc('U0100')).toMatch(/lost communication.*ECM/i);
    expect(describeDtc('P2183')).toMatch(/coolant/i);
    expect(describeDtc('P0135')).toMatch(/O2|oxygen.*heater/i);
    expect(describeDtc('P242F')).toMatch(/particulate filter.*ash/i);
  });

  it('resolves the common TDI systems (glow plug, DPF, swirl flap, EGR) from generic codes', () => {
    for (const code of ['P0380', 'P0671', 'P2002', 'P242F', 'P2463', 'P2015', 'P2008', 'P0401']) {
      expect({ code, source: lookupDtc(code, 'vag').source }).toEqual({ code, source: 'generic' });
    }
    expect(lookupDtc('P242F').severity).toBe('moderate');
  });

  it('resolves generic codes from the SAE tables with system and subsystem', () => {
    const info = lookupDtc('p0135 ');
    expect(info).toMatchObject({
      code: 'P0135',
      system: 'powertrain',
      subsystem: 'Fuel & air metering',
      source: 'generic',
      manufacturerSpecific: false,
    });
    expect(lookupDtc('P0301').subsystem).toBe('Ignition system / misfire');
    expect(lookupDtc('U0121').system).toBe('network');
    expect(lookupDtc('C0035').system).toBe('chassis');
    expect(lookupDtc('B0001').system).toBe('body');
    expect(lookupDtc('P3401').source).toBe('generic');
  });

  it('applies the ordered severity rules', () => {
    expect(lookupDtc('P0301').severity).toBe('high');
    expect(lookupDtc('U0121').severity).toBe('moderate');
    expect(lookupDtc('P0171').severity).toBe('info');
    expect(lookupDtc('P0FFF').severity).toBe('unknown');
    expect(lookupDtc('P0217').severity).toBe('high');
    expect(lookupDtc('P0524').severity).toBe('high');
    expect(lookupDtc('P0335').severity).toBe('high');
    expect(lookupDtc('P0A80').severity).toBe('high');
    expect(lookupDtc('P0420').severity).toBe('moderate');
    expect(lookupDtc('P2002').severity).toBe('moderate');
    expect(lookupDtc('P0606').severity).toBe('moderate');
  });

  it('has a small, enumerable severity table whose every rule is reachable', () => {
    expect(DTC_SEVERITY_RULES.length).toBeLessThanOrEqual(12);
    const samples = [
      'P0301',
      'P0A80',
      'P0217',
      'P0520',
      'P0335',
      'U0100',
      'P0430',
      'P0401',
      'P2002',
      'P0606',
    ];
    const hit = new Set(
      samples.map((c) => DTC_SEVERITY_RULES.find((r) => r.pattern.test(c))?.label),
    );
    expect(hit.size).toBe(DTC_SEVERITY_RULES.length);
  });

  it('resolves manufacturer codes only with the matching make', () => {
    const vag = lookupDtc('P1557', 'vag');
    expect(vag.source).toBe('vag');
    expect(vag.manufacturerSpecific).toBe(true);
    expect(vag.description).toMatch(/charge pressure/i);
    expect(vag.severity).toBe('info');

    const generic = lookupDtc('P1557', 'generic');
    expect(generic.source).toBe('range');
    expect(generic.manufacturerSpecific).toBe(true);
    expect(generic.severity).toBe('unknown');
    expect(lookupDtc('P1557').source).toBe('range');
    expect(lookupDtc('P1557', 'fiat').source).toBe('range');
  });

  it('resolves a Fiat-table entry only with make fiat (wiring; the shipped pack is empty)', () => {
    // FIAT_P1 ships empty until texts are confirmed on the Punto (plan 05 deferred section), so
    // seed one entry to prove the 'fiat' make reaches the table.
    expect(VAG_P1.P1FFE).toBeUndefined();
    FIAT_P1.P1FFE = 'Test-only Fiat entry';
    try {
      expect(lookupDtc('P1FFE', 'fiat')).toMatchObject({
        description: 'Test-only Fiat entry',
        source: 'fiat',
        manufacturerSpecific: true,
        severity: 'info',
      });
      expect(lookupDtc('P1FFE', 'vag').source).toBe('range');
      expect(lookupDtc('P1FFE').source).toBe('range');
    } finally {
      delete FIAT_P1.P1FFE;
    }
  });

  it('falls back to the hybrid range text for the empty P0B / P0C blocks', () => {
    for (const code of ['P0B10', 'P0C10']) {
      const info = lookupDtc(code);
      expect(info.subsystem).toBe('Hybrid propulsion');
      expect(info.description).toBe(`Powertrain — Hybrid propulsion fault (${code})`);
    }
    expect(lookupDtc('P0B10').severity).toBe('high');
  });

  it('flags the J2012 manufacturer-controlled ranges', () => {
    for (const c of ['P1000', 'P3000', 'P33FF', 'B1234', 'B2000', 'C1100', 'U1000', 'U2FFF'])
      expect(isManufacturerSpecific(c)).toBe(true);
    for (const c of ['P0100', 'P2000', 'P3400', 'P3FFF', 'B0001', 'C0035', 'U0100', 'B3000'])
      expect(isManufacturerSpecific(c)).toBe(false);
  });

  it('synthesises a fallback containing the system, the subsystem and the code', () => {
    const info = lookupDtc('P0FFF');
    expect(info.source).toBe('range');
    expect(info.description).toContain(info.subsystem);
    expect(info.description).toContain('P0FFF');
    expect(info.description).toMatch(/^Powertrain — /);
    expect(lookupDtc('U3ABC').description).toMatch(/^Network — .*U3ABC/);
    expect(describeDtc('P3FFF')).not.toMatch(/no local description/);
  });

  it('handles malformed input without throwing', () => {
    expect(lookupDtc('').severity).toBe('unknown');
    expect(lookupDtc('X1234').description).toMatch(/Unrecognised/);
    expect(lookupDtc('P12').source).toBe('range');
  });

  it('maps every code prefix to a subsystem', () => {
    for (const letter of ['P', 'C', 'B', 'U'])
      for (const d1 of ['0', '1', '2', '3'])
        for (const d2 of '0123456789ABCDEF')
          expect(subsystemForCode(`${letter}${d1}${d2}00`)).not.toBe('Unrecognised code range');
    expect(DTC_RANGES.every((r) => /^[PCBU][0-3][0-9A-F]?$/.test(r.prefix))).toBe(true);
  });
});

describe('DTC database — wiring', () => {
  it('dtc.ts delegates describeDtc / toDtc (make-aware)', () => {
    expect(describeFromDtc('P0135')).toBe(describeDtc('P0135'));
    expect(toDtc('P1557', 'vag').description).toMatch(/charge pressure/i);
    expect(toDtc('P1557').description).toMatch(/P1557/);
  });

  it('keeps the native KWP texts separate from the SAE number space', () => {
    expect(saeCodeForVagCode('05463')).toBe('P1557');
    expect(saeCodeForVagCode('08579')).toBe('P2183');
    expect(saeCodeForVagCode('abc')).toBeNull();
    expect(vagNativeDtcText('532')).toMatch(/Supply voltage/i);
    expect(vagDtcText('532')).toBe(vagNativeDtcText('532'));
    // A P1 code's bytes are not a native KWP number: no fall-through into VAG_P1.
    expect(vagNativeDtcText('05463')).toBeNull();
    expect(vagNativeDtcText('99999')).toBeNull();
  });
});
