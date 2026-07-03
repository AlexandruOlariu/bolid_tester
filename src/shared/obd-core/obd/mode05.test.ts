import { decodeMode05 } from './mode05';

describe('Mode 05 decode', () => {
  it('decodes a threshold TID to volts', () => {
    const r = decodeMode05([0x45, 0x01, 0x01, 0x64]);
    expect(r?.name).toMatch(/Rich→lean/);
    expect(r?.volts).toBe(0.5);
    expect(r?.sensor).toBe('01');
  });
  it('keeps unknown TIDs raw and rejects foreign bytes', () => {
    const r = decodeMode05([0x45, 0x07, 0x02, 0x12, 0x34]);
    expect(r?.name).toBe('TID 07');
    expect(r?.volts).toBeNull();
    expect(decodeMode05([0x46, 0x01, 0x01, 0x64])).toBeNull();
  });
});
