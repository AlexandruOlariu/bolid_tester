import {
  applyPreset,
  revertPreset,
  detectPresetState,
  CodingPreset,
} from './presets';

// Mirrors the shipped Golf Plus BCM coding (reqHeader 70E, DID F1A0, [01 00 10 00]).
const drl: CodingPreset = {
  id: 'drl',
  title: 'Daytime running lights',
  description: 'Toggle DRL.',
  reqHeader: '70E',
  edits: [{ byte: 0, bit: 0, mask: 0x01, onValue: 0x01, offValue: 0x00 }],
  reversible: true,
};

const blink: CodingPreset = {
  id: 'blink',
  title: 'One-touch turn signals (3 blinks)',
  description: 'Set the comfort one-touch blink count to 3.',
  reqHeader: '70E',
  edits: [{ byte: 2, mask: 0x0f, onValue: 0x03, offValue: 0x00 }],
  reversible: true,
};

describe('applyPreset / revertPreset', () => {
  it('applies a single-bit tweak immutably', () => {
    const before = [0x00, 0x00, 0x10, 0x00];
    const after = applyPreset(before, drl);
    expect(after[0]).toBe(0x01);
    expect(before[0]).toBe(0x00); // original untouched
  });

  it('reverts a bit to its off value without touching other bits in the byte', () => {
    const before = [0x03, 0x00, 0x10, 0x00]; // bit0 (DRL) + bit1 set
    const after = revertPreset(before, drl);
    expect(after[0]).toBe(0x02); // DRL cleared, bit1 preserved
  });

  it('writes a masked nibble in place, preserving the high nibble', () => {
    const before = [0x01, 0x00, 0x10, 0x00];
    const after = applyPreset(before, blink);
    expect(after[2]).toBe(0x13); // low nibble 3, high nibble 1 preserved
    expect(revertPreset(after, blink)[2]).toBe(0x10); // reversible
  });
});

describe('detectPresetState', () => {
  it('detects on when every edit matches onValue', () => {
    expect(detectPresetState([0x01, 0x00, 0x10, 0x00], drl)).toBe('on');
    expect(detectPresetState([0x01, 0x00, 0x13, 0x00], blink)).toBe('on');
  });

  it('detects off when every edit matches offValue', () => {
    expect(detectPresetState([0x00, 0x00, 0x10, 0x00], drl)).toBe('off');
    expect(detectPresetState([0x01, 0x00, 0x10, 0x00], blink)).toBe('off');
  });

  it('reports unknown for a foreign nibble value', () => {
    expect(detectPresetState([0x01, 0x00, 0x15, 0x00], blink)).toBe('unknown'); // 5 blinks
  });

  it('reports unknown when a multi-edit preset is only partially applied', () => {
    const combo: CodingPreset = {
      id: 'combo',
      title: 'combo',
      description: '',
      reqHeader: '70E',
      edits: [
        { byte: 0, bit: 0, mask: 0x01, onValue: 0x01, offValue: 0x00 },
        { byte: 1, bit: 0, mask: 0x01, onValue: 0x01, offValue: 0x00 },
      ],
      reversible: true,
    };
    expect(detectPresetState([0x01, 0x00], combo)).toBe('unknown'); // first on, second off
    expect(detectPresetState([0x01, 0x01], combo)).toBe('on');
    expect(detectPresetState([0x00, 0x00], combo)).toBe('off');
  });
});
