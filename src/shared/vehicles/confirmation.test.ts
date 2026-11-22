import {
  allConfirmed,
  confirmationProblems,
  profileConfirmations,
  verificationState,
  verificationText,
} from './confirmation';
import { getVehicleProfile } from '.';
import type { VehicleProfile } from './types';

const CONFIRMED = { on: '2026-11-20', source: 'sniffer-capture' as const };

describe('verificationState / verificationText', () => {
  it('standard OBD2 when experimental is false', () => {
    expect(verificationState({ experimental: false })).toBe('standard');
    expect(verificationText({ experimental: false })).toBe('Standard OBD2');
  });

  it('confirmed when the item carries evidence', () => {
    const item = { experimental: true, confirmed: CONFIRMED };
    expect(verificationState(item)).toBe('confirmed');
    expect(verificationText(item)).toBe('Confirmed 2026-11-20 (sniffer capture)');
    expect(verificationText({ confirmed: { on: '2026-12-01', source: 'on-car' } })).toBe(
      'Confirmed 2026-12-01 (on the car)',
    );
    expect(verificationText({ confirmed: { on: '2026-12-02', source: 'vcds-log' } })).toBe(
      'Confirmed 2026-12-02 (VCDS log)',
    );
  });

  it('unverified otherwise (the illustrative default)', () => {
    expect(verificationState({ experimental: true })).toBe('unverified');
    expect(verificationState({})).toBe('unverified');
    expect(verificationText({ experimental: true })).toBe(
      'Illustrative — not yet confirmed on this car',
    );
  });

  it('allConfirmed needs a non-empty, fully confirmed list', () => {
    expect(allConfirmed([])).toBe(false);
    expect(allConfirmed([{ experimental: true, confirmed: CONFIRMED }])).toBe(true);
    expect(
      allConfirmed([{ experimental: true, confirmed: CONFIRMED }, { experimental: true }]),
    ).toBe(false);
    expect(allConfirmed([{ experimental: false }])).toBe(true);
  });
});

describe('confirmationProblems (the evidence rule)', () => {
  const golf = getVehicleProfile('golf-plus-2009-20tdi');
  const withEngine = (fixture: string | undefined, on = '2026-11-20'): VehicleProfile => ({
    ...golf,
    modules: (golf.modules ?? []).map((m) =>
      m.address === '01' ? { ...m, confirmed: { on, source: 'on-car', fixture } } : m,
    ),
  });
  const exists = (p: string) => p === 'docs/captures/golf-plus-2009-20tdi-discover-2026-11-20.csv';

  it('passes a fixture that exists under an evidence directory', () => {
    const p = withEngine('docs/captures/golf-plus-2009-20tdi-discover-2026-11-20.csv');
    expect(profileConfirmations(p).map((c) => c.where)).toEqual(['modules 01 (uds)']);
    expect(confirmationProblems(p, exists)).toEqual([]);
    expect(confirmationProblems(withEngine(undefined), exists)).toEqual([]);
  });

  it('flags a missing file, a path outside the evidence dirs, and a bad date', () => {
    expect(confirmationProblems(withEngine('docs/captures/bogus.csv'), exists)).toEqual([
      'golf-plus-2009-20tdi modules 01 (uds): fixture docs/captures/bogus.csv does not exist',
    ]);
    expect(confirmationProblems(withEngine('README.md'), () => true)).toEqual([
      expect.stringMatching(/fixture README\.md is not under/),
    ]);
    expect(confirmationProblems(withEngine('docs/captures/../../README.md'), () => true)).toEqual([
      expect.stringMatching(/is not under/),
    ]);
    expect(confirmationProblems(withEngine(undefined, '20.11.2026'), exists)).toEqual([
      'golf-plus-2009-20tdi modules 01 (uds): confirmed.on "20.11.2026" is not YYYY-MM-DD',
    ]);
  });

  it('sees every profile array that can carry a confirmation', () => {
    const c = { confirmed: CONFIRMED };
    const p: VehicleProfile = {
      ...golf,
      extendedPids: golf.extendedPids?.slice(0, 1).map((x) => ({ ...x, ...c })),
      modules: golf.modules?.slice(0, 1).map((x) => ({ ...x, ...c })),
      routines: golf.routines?.slice(0, 1).map((x) => ({ ...x, ...c })),
      adaptations: golf.adaptations?.slice(0, 1).map((x) => ({ ...x, ...c })),
      codingModules: golf.codingModules?.slice(0, 1).map((x) => ({ ...x, ...c })),
      codingPresets: golf.codingPresets?.slice(0, 1).map((x) => ({ ...x, ...c })),
      moduleSensors: golf.moduleSensors?.slice(0, 1).map((x) => ({ ...x, ...c })),
      loginCodes: [{ address: '17', code: 1, purpose: 'x', source: 'documented', ...c }],
      serviceReset: golf.serviceReset ? { ...golf.serviceReset, ...c } : undefined,
    };
    expect(profileConfirmations(p)).toHaveLength(9);
  });
});
