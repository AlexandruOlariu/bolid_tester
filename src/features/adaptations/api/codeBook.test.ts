/** The code book (plan 22): a remembered code lands on the garage car or in the login book
 *  (`bolid.loginBook`) — never in `bolid.settings` — and resolves back for the channel. Node-safe:
 *  the persist storage runs over an in-memory file map. */
const files = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/tmp/bolid-test/',
  cacheDirectory: '/tmp/bolid-test/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: files.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => files.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    files.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    files.delete(uri);
  }),
}));

import { useGarageStore, sanitizeGarage } from '@/shared/state/garageStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { resolveProfile } from '@/shared/vehicles/resolve';
import { getVehicleProfile, type AdaptationChannel } from '@/shared/vehicles';
import { useLoginBookStore, sanitizeLoginBook } from '../model/loginBookStore';
import {
  forgetLoginCode,
  loginBookKeys,
  loginFor,
  preVinCodeBook,
  rememberLoginCode,
  userCodeBook,
} from './codeBook';

const passat = getVehicleProfile('passat-b55-19tdi');
const idle = (passat.adaptations ?? []).find((c) => c.did === '2A') as AdaptationChannel;
const VIN = 'WVWZZZ3BZ4E342958';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  files.clear();
  useGarageStore.setState({ vehicles: [] });
  useLoginBookStore.setState({ byVehicle: {} });
});

describe('code book for a registry car', () => {
  it('remembers under the VIN key, resolves it, and never touches bolid.settings', async () => {
    const settingsBefore = JSON.stringify(useSettingsStore.getState());
    rememberLoginCode(passat, VIN, idle, { code: 24680 });
    await flush();

    expect(useLoginBookStore.getState().byVehicle).toEqual({
      [`vin:${VIN}`]: [
        { address: '01', code: 24680, purpose: 'Idle speed adaptation', source: 'user-entered' },
      ],
    });
    const user = userCodeBook(passat, VIN);
    expect(loginFor(passat, user, idle)?.code).toBe(24680);

    const loginBookFile = [...files.entries()].find(([k]) => k.endsWith('bolid.loginBook.json'));
    expect(loginBookFile?.[1]).toContain('24680');
    const settingsFile = [...files.entries()].find(([k]) => k.endsWith('bolid.settings.json'));
    expect(settingsFile?.[1] ?? '').not.toContain('24680');
    expect(JSON.stringify(useSettingsStore.getState())).toBe(settingsBefore);
  });

  it('a code remembered before the VIN was known is a pre-fill only once the VIN is known', () => {
    rememberLoginCode(passat, null, idle, { code: 1357, wsc: 42 });
    expect(loginBookKeys(passat.id, VIN)).toEqual([`vin:${VIN}`, `id:${passat.id}`]);
    // Without a VIN the profile-id book is the car's own.
    expect(loginFor(passat, userCodeBook(passat, null), idle)).toMatchObject({
      code: 1357,
      wsc: 42,
    });
    expect(preVinCodeBook(passat, null)).toBeNull();
    // With a VIN it is not: any car on this profile could have filed it. It stays reachable as a
    // pre-fill (the sheet still opens), never as this car's remembered code.
    expect(userCodeBook(passat, VIN)).toBeNull();
    expect(loginFor(passat, preVinCodeBook(passat, VIN), idle)).toMatchObject({ code: 1357 });
  });

  it('another car on the same profile never inherits, nor deletes, a remembered code', () => {
    const OTHER_VIN = 'WVWZZZ3BZ5E000001';
    rememberLoginCode(passat, null, idle, { code: 1357 });
    rememberLoginCode(passat, VIN, idle, { code: 9753 });
    expect(loginFor(passat, userCodeBook(passat, VIN), idle)?.code).toBe(9753);
    expect(userCodeBook(passat, OTHER_VIN)).toBeNull();

    // The other car rejects the pre-VIN code / forgets its own: neither book of this car changes.
    forgetLoginCode(passat, OTHER_VIN, idle);
    expect(useLoginBookStore.getState().byVehicle).toEqual({
      [`id:${passat.id}`]: [expect.objectContaining({ code: 1357 })],
      [`vin:${VIN}`]: [expect.objectContaining({ code: 9753 })],
    });

    // Forget on this car removes only its own (VIN) entry; the pre-VIN one stays for its owner.
    forgetLoginCode(passat, VIN, idle);
    expect(useLoginBookStore.getState().byVehicle).toEqual({
      [`id:${passat.id}`]: [expect.objectContaining({ code: 1357 })],
    });
    forgetLoginCode(passat, null, idle);
    expect(useLoginBookStore.getState().byVehicle).toEqual({});
  });

  it('a channel without login needs no code', () => {
    const golf = getVehicleProfile('golf-plus-2009-20tdi');
    const uds = (golf.adaptations ?? [])[0];
    expect(loginFor(golf, null, uds)).toBeNull();
  });
});

describe('code book for a garage car', () => {
  it('stores the code on the UserVehicle (bolid.garage), not in the login book', () => {
    const car = useGarageStore.getState().add({
      name: 'My Passat',
      fuel: 'diesel',
      baseProfileId: 'passat-b55-19tdi',
    });
    const profile = resolveProfile(car.id, useGarageStore.getState().vehicles);
    expect(profile.adaptations?.[0].did).toBe('2A');

    rememberLoginCode(profile, VIN, idle, { code: 9999 });
    expect(useGarageStore.getState().vehicles[0].loginCodes).toEqual([
      { address: '01', code: 9999, purpose: 'Idle speed adaptation', source: 'user-entered' },
    ]);
    expect(useLoginBookStore.getState().byVehicle).toEqual({});
    expect(loginFor(profile, userCodeBook(profile, VIN), idle)?.code).toBe(9999);

    forgetLoginCode(profile, VIN, idle);
    expect(useGarageStore.getState().vehicles[0].loginCodes).toBeUndefined();
  });
});

describe('persisted code books are sanitized', () => {
  it('drops malformed login codes from garage records and the login book', () => {
    const [car] = sanitizeGarage({
      vehicles: [
        {
          id: 'user:x',
          name: 'X',
          fuel: 'diesel',
          baseProfileId: 'generic',
          createdAt: 1,
          updatedAt: 1,
          loginCodes: [{ address: '01', code: 'nope' }],
        },
      ],
    });
    expect(car.loginCodes).toBeUndefined();
    expect(
      sanitizeLoginBook({
        byVehicle: {
          'id:a': [{ address: '01', code: 5, purpose: 'p', source: 'user-entered' }],
          'id:b': 'garbage',
        },
      }),
    ).toEqual({ 'id:a': [{ address: '01', code: 5, purpose: 'p', source: 'user-entered' }] });
    expect(sanitizeLoginBook(null)).toEqual({});
  });
});
