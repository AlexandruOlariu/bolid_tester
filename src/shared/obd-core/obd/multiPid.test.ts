import { chunkPids, buildMultiPidRequest, parseMultiPidResponse } from './multiPid';

describe('multi-PID batching', () => {
  it('chunks to at most 6 PIDs', () => {
    const pids = ['0104', '0105', '010B', '010C', '010D', '010F', '0110', '0111'];
    const chunks = chunkPids(pids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(6);
    expect(chunks[1]).toHaveLength(2);
  });

  it('builds the combined request', () => {
    expect(buildMultiPidRequest(['010C', '0105', '010D'])).toBe('010C050D');
  });

  it('parses an interleaved response with mixed byte counts', () => {
    // 41 | 0C 0C D0 (rpm, 2B) | 05 7D (coolant, 1B) | 0D 00 (speed, 1B)
    const entries = parseMultiPidResponse([0x41, 0x0c, 0x0c, 0xd0, 0x05, 0x7d, 0x0d, 0x00]);
    expect(entries).toEqual([
      { pid: '010C', data: [0x0c, 0xd0] },
      { pid: '0105', data: [0x7d] },
      { pid: '010D', data: [0x00] },
    ]);
  });

  it('handles ECUs omitting unsupported PIDs', () => {
    const entries = parseMultiPidResponse([0x41, 0x05, 0x7d]);
    expect(entries).toEqual([{ pid: '0105', data: [0x7d] }]);
  });

  it('returns null for non-multi responses and unknown leading PIDs', () => {
    expect(parseMultiPidResponse([0x43, 0x00])).toBeNull();
    expect(parseMultiPidResponse([0x41, 0xee, 0x00])).toBeNull();
  });
});
