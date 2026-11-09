import * as fs from 'fs';
import * as path from 'path';
import { validate } from '../validate';
import { LABEL_PACKS } from '../../labels/registry';
import { VEHICLE_PROFILES } from '../../vehicles';
import { labelPackFileV1, labelPackV1, profileFileV1 } from './schemas';
import { exportLabelPack, exportProfileSeed } from './export';
import { parseExchangeFile } from './import';

const EXAMPLES = path.resolve(__dirname, '../../../../docs/examples');
const readExample = (name: string) => fs.readFileSync(path.join(EXAMPLES, name), 'utf8');
const META = { appVersion: '0.1.0', now: Date.UTC(2026, 10, 9) };

describe('exchange schemas', () => {
  it('both example files validate', () => {
    const profile = validate(profileFileV1, JSON.parse(readExample('profile.example.json')));
    expect(profile.ok).toBe(true);
    const pack = validate(labelPackFileV1, JSON.parse(readExample('label-pack.example.json')));
    expect(pack.ok).toBe(true);
    if (pack.ok) {
      expect(pack.value.payload.partNumberPrefixes).toEqual(['03L906022']);
      expect(pack.value.payload.adaptations?.['3001']?.description).toMatch(/^Example pack/);
    }
  });

  it('rejects an unknown schema version with a readable message', () => {
    const raw = JSON.parse(readExample('profile.example.json')) as Record<string, unknown>;
    const r = validate(profileFileV1, { ...raw, schema: 'bolid.profile.v9' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toBe(
      '/schema: expected one of bolid.profile.v1, got "bolid.profile.v9"',
    );
    const parsed = parseExchangeFile(JSON.stringify({ ...raw, schema: 'bolid.profile.v9' }));
    expect('error' in parsed && parsed.error).toMatch(/newer version of the app/);
  });

  it("rejects a DID '17G1' at /payload/measurements", () => {
    const raw = JSON.parse(readExample('label-pack.example.json')) as {
      payload: { measurements: Record<string, unknown> };
    };
    raw.payload.measurements['17G1'] = { name: 'Bogus' };
    const r = validate(labelPackFileV1, raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual([
      '/payload/measurements: key "17G1" is not a 4-digit uppercase hex DID',
    ]);
  });

  it('rejects lowercase / spaced part-number prefixes and too many group DIDs', () => {
    const base = JSON.parse(readExample('label-pack.example.json')) as {
      payload: Record<string, unknown>;
    };
    const lower = { ...base.payload, partNumberPrefixes: ['03l906022'] };
    expect(validate(labelPackV1, lower).ok).toBe(false);
    const spaced = { ...base.payload, partNumberPrefixes: ['03L 906 022'] };
    expect(validate(labelPackV1, spaced).ok).toBe(false);
    const none = { ...base.payload, partNumberPrefixes: [] };
    expect(validate(labelPackV1, none).ok).toBe(false);
    const big = {
      ...base.payload,
      measuringGroups: { '001': { name: 'x', dids: ['1701', '1702', '1703', '1704', '1705'] } },
    };
    const r = validate(labelPackV1, big);
    expect(!r.ok && r.errors[0]).toMatch(/^\/measuringGroups\/001\/dids: at most 4 items/);
  });

  it('strips unknown fields everywhere (a newer app may add fields)', () => {
    const raw = JSON.parse(readExample('profile.example.json')) as {
      payload: { vehicle: Record<string, unknown> };
    } & Record<string, unknown>;
    raw.future = 1;
    raw.payload.vehicle.loginCodes = [
      { address: '01', code: 12345, purpose: 'x', source: 'documented' },
    ];
    raw.payload.vehicle.decode = 'function () {}';
    const r = validate(profileFileV1, raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('future' in r.value).toBe(false);
      expect('loginCodes' in r.value.payload.vehicle).toBe(false);
      expect('decode' in r.value.payload.vehicle).toBe(false);
    }
  });

  it('validates a learned identity and discovered modules strictly', () => {
    const raw = JSON.parse(readExample('profile.example.json')) as {
      payload: { vehicle: Record<string, unknown> };
    };
    const learned = {
      protocol: 'ISO_15765_4_CAN_11_500',
      supportedPids: ['010C', '010D'],
      vin: 'WVWZZZ1KZ9W903398',
      calibrationId: '03L906022LM 4023',
      learnedAt: 1,
    };
    raw.payload.vehicle.learned = learned;
    expect(validate(profileFileV1, raw).ok).toBe(true);
    raw.payload.vehicle.learned = { ...learned, protocol: 'CAN_FD' };
    expect(validate(profileFileV1, raw).ok).toBe(false);
    raw.payload.vehicle.learned = { ...learned, supportedPids: ['220C'] };
    expect(validate(profileFileV1, raw).ok).toBe(false);
    raw.payload.vehicle.learned = learned;
    raw.payload.vehicle.modules = [
      { address: '03', name: 'ABS', transport: 'uds', reqHeader: '713', experimental: true },
    ];
    const r = validate(profileFileV1, raw);
    expect(!r.ok && r.errors).toEqual([
      '/payload/vehicle/modules/0: a UDS module needs reqHeader and rxFilter',
    ]);
  });

  it('every bundled pack and built-in profile exports to a valid file', () => {
    for (const pack of LABEL_PACKS) {
      const file = JSON.parse(JSON.stringify(exportLabelPack(pack, META))) as unknown;
      const r = validate(labelPackFileV1, file);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual(file);
    }
    for (const p of VEHICLE_PROFILES) {
      const file = JSON.parse(JSON.stringify(exportProfileSeed(p, META))) as unknown;
      const r = validate(profileFileV1, file);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toEqual(file);
    }
  });
});
