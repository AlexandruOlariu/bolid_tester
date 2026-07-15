import { buildCodingView, mergeCodingLabels, CodingBitDescriptor } from './codingHelper';
import { CodingField } from './coding';

describe('mergeCodingLabels', () => {
  const schema: CodingField[] = [
    { byte: 0, bit: 0, name: 'Daytime running lights' },
    { byte: 1, bit: 0, name: 'Needle sweep on start' },
  ];

  it('adds label-pack bits the schema does not already name', () => {
    const pack: CodingBitDescriptor[] = [
      { byte: 0, bit: 1, name: 'Coming-home lights' },
      { byte: 2, mask: 0x0f, name: 'One-touch turn signal blinks' },
    ];
    const merged = mergeCodingLabels(schema, pack);
    expect(merged).toHaveLength(4);
    expect(merged.map((f) => f.name)).toContain('Coming-home lights');
    expect(merged.find((f) => f.byte === 2)?.mask).toBe(0x0f);
  });

  it('lets the profile schema win on a conflicting field (schema is authoritative)', () => {
    const pack: CodingBitDescriptor[] = [{ byte: 0, bit: 0, name: 'DRL (pack name)' }];
    const merged = mergeCodingLabels(schema, pack);
    expect(merged).toHaveLength(2); // no duplicate byte0/bit0 field added
    expect(merged.find((f) => f.byte === 0 && f.bit === 0)?.name).toBe('Daytime running lights');
  });

  it('returns the schema unchanged when there is no pack', () => {
    expect(mergeCodingLabels(schema)).toEqual(schema);
  });
});

describe('buildCodingView', () => {
  const fields: CodingField[] = [
    { byte: 0, bit: 0, name: 'Daytime running lights' },
    { byte: 0, bit: 1, name: 'Coming-home lights' },
    { byte: 2, mask: 0x0f, name: 'One-touch turn signal blinks' },
  ];

  it('breaks each byte into 8 msb-first bits with hex + named bits', () => {
    const view = buildCodingView([0x01, 0x00, 0x13, 0x00], fields);
    expect(view).toHaveLength(4);
    expect(view[0].hex).toBe('01');
    expect(view[0].bits[0].bit).toBe(7); // msb first
    expect(view[0].bits[7].bit).toBe(0);
    expect(view[0].bits[7].value).toBe(1); // 0x01 -> bit 0 set
    expect(view[0].bits[7].name).toBe('Daytime running lights');
    expect(view[0].bits[6].name).toBe('Coming-home lights');
  });

  it('exposes masked field values in place', () => {
    const view = buildCodingView([0x01, 0x00, 0x13, 0x00], fields);
    const blink = view[2].fields.find((f) => f.mask === 0x0f);
    expect(blink?.value).toBe(0x03); // low nibble of 0x13
    expect(blink?.name).toBe('One-touch turn signal blinks');
  });

  it('flags changed bytes against a baseline for the live preview', () => {
    const before = [0x01, 0x00, 0x10, 0x00];
    const after = [0x01, 0x00, 0x13, 0x00];
    const view = buildCodingView(after, fields, before);
    expect(view.map((b) => b.changed)).toEqual([false, false, true, false]);
  });

  it('leaves `changed` undefined when no baseline is given', () => {
    const view = buildCodingView([0x01], fields);
    expect(view[0].changed).toBeUndefined();
  });
});
