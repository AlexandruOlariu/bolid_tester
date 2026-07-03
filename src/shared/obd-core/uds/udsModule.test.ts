import {
  decodeDtcStatusByte,
  parseReportDtcByStatusMask,
  readModuleDtcs,
  clearModuleDtcs,
  readDtcSnapshot,
  readModuleIdent,
} from './udsModule';
import { UdsError, UdsSend } from '../coding/udsCoding';
import { vagDtcText } from './vagDtcs';

const senderFor = (map: Record<string, number[] | null>): UdsSend => {
  return async (cmd) => {
    const key = cmd.toUpperCase();
    if (key in map) return map[key];
    return null;
  };
};

describe('decodeDtcStatusByte', () => {
  it('decodes the ISO 14229 bits', () => {
    const s = decodeDtcStatusByte(0x89); // warningIndicator + confirmed + testFailed
    expect(s.testFailed).toBe(true);
    expect(s.confirmed).toBe(true);
    expect(s.warningIndicator).toBe(true);
    expect(s.pending).toBe(false);
  });
});

describe('parseReportDtcByStatusMask', () => {
  it('parses two DTCs with status bytes', () => {
    // P0299 00 confirmed+failed, P2183 00 pending
    const res = [0x59, 0x02, 0xff, 0x02, 0x99, 0x00, 0x09, 0x21, 0x83, 0x00, 0x04];
    const dtcs = parseReportDtcByStatusMask(res);
    expect(dtcs).toHaveLength(2);
    expect(dtcs[0].sae).toBe('P0299');
    expect(dtcs[0].display).toBe('P0299 00');
    expect(dtcs[0].statusFlags.confirmed).toBe(true);
    expect(dtcs[1].sae).toBe('P2183');
    expect(dtcs[1].statusFlags.pending).toBe(true);
    // VAG decimal of the two raw bytes (the profile-verified scheme): 0x2183 = 8579
    expect(dtcs[1].vagCode).toBe('08579');
  });

  it('parses an empty store (no DTC records)', () => {
    expect(parseReportDtcByStatusMask([0x59, 0x02, 0xff])).toEqual([]);
  });

  it('throws on a foreign response', () => {
    expect(() => parseReportDtcByStatusMask([0x59, 0x0a, 0x00])).toThrow(UdsError);
  });
});

describe('readModuleDtcs / clearModuleDtcs', () => {
  it('requests 1902 with the default stored-faults mask 0x09', async () => {
    const send = senderFor({ '190209': [0x59, 0x02, 0x09, 0x02, 0x99, 0x00, 0x09] });
    const dtcs = await readModuleDtcs(send);
    expect(dtcs).toHaveLength(1);
    expect(dtcs[0].sae).toBe('P0299');
  });

  it('throws UdsError on a negative response', async () => {
    const send = senderFor({ '1902FF': [0x7f, 0x19, 0x31] });
    await expect(readModuleDtcs(send, 0xff)).rejects.toBeInstanceOf(UdsError);
  });

  it('clears with group FFFFFF and accepts the 0x54 ack', async () => {
    const send = senderFor({ '14FFFFFF': [0x54] });
    await expect(clearModuleDtcs(send)).resolves.toBeUndefined();
  });
});

describe('readDtcSnapshot', () => {
  it('returns the raw payload after 0x59 0x04', async () => {
    const send2: UdsSend = async (cmd) =>
      cmd.toUpperCase() === '1904029900FF'
        ? [0x59, 0x04, 0x02, 0x99, 0x00, 0x09, 0x01, 0x01, 0x0c, 0x0c, 0xd0]
        : null;
    const raw = await readDtcSnapshot(send2, [0x02, 0x99, 0x00]);
    expect(raw.slice(0, 3)).toEqual([0x02, 0x99, 0x00]);
  });
});

describe('readModuleIdent', () => {
  it('collects ASCII ident DIDs tolerantly', async () => {
    const ascii = (s: string) => s.split('').map((c) => c.charCodeAt(0));
    const send = senderFor({
      '22F187': [0x62, 0xf1, 0x87, ...ascii('03G906016A ')],
      '22F189': [0x62, 0xf1, 0x89, ...ascii('4023')],
      '22F197': [0x62, 0xf1, 0x97, ...ascii('R4 2,0L EDC')],
      '22F191': null,
      '22F18C': null,
    });
    const ident = await readModuleIdent(send);
    expect(ident.partNumber).toBe('03G906016A');
    expect(ident.softwareVersion).toBe('4023');
    expect(ident.systemName).toBe('R4 2,0L EDC');
    expect(ident.hardwareNumber).toBeUndefined();
  });
});

describe('vagDtcText', () => {
  it('knows a seed code and pads short ones', () => {
    expect(vagDtcText('532')).toMatch(/Supply voltage/i);
    expect(vagDtcText('99999')).toBeNull();
  });
});
