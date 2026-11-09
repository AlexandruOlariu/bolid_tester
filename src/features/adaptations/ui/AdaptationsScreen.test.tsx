/** The KWP login flow on the Adaptations screen (plan 22) against the simulated Passat (K-line),
 *  whose illustrative engine channel needs a login. The in-app simulator accepts only its
 *  placeholder code 12345 (not a real login code). Also: the Golf's UDS channels never ask for a
 *  login. */
import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { CONFIRMED_TEXT, ILLUSTRATIVE_TEXT, confirmItems } from '@test/confirmation';
import { getVehicleProfile } from '@/shared/vehicles';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useAdaptationsStore } from '../model/adaptationsStore';
import { useLoginBookStore } from '../model/loginBookStore';
import { useModuleScanStore } from '@/features/module-scan/model/moduleScanStore';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { applyImport, previewImport } from '@/shared/state/exchangeService';
import { isParseError, parseExchangeFile } from '@/shared/lib/exchange';
import * as fs from 'fs';
import * as path from 'path';
import { AdaptationsScreen, KWP1281_LIMIT } from './AdaptationsScreen';

const SIM_CODE = '12345';
/** The VIN the simulated Passat reports (`SAMPLE_VINS`), so its own login-book key. */
const SIM_VIN_KEY = 'vin:WVWZZZ3BZ4E342958';

async function press(text: string | RegExp) {
  await act(async () => {
    fireEvent.press(screen.getByText(text));
  });
}

async function passatScreen() {
  useVehicleStore.setState({ selectedProfileId: 'passat-b55-19tdi' });
  await connectSimulator({ vehicleId: 'passat-b55-19tdi' });
  useAdaptationsStore.setState({ unlocked: true });
  renderWithProviders(<AdaptationsScreen />);
  await press('Read');
  expect(await screen.findByText('850rpm')).toBeTruthy();
}

async function enterValue(v: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('New value for Idle speed adaptation'), v);
  });
  await press('Write');
}

async function submitLogin(code: string, opts: { remember?: boolean } = {}) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Login code'), code);
  });
  if (opts.remember) await press('Remember for this car');
  await press('Continue');
}

describe('AdaptationsScreen — KWP login (simulated Passat)', () => {
  it('shows the K-line limit and the login status for the KWP channel', async () => {
    await passatScreen();
    expect(screen.getByText(KWP1281_LIMIT)).toBeTruthy();
    expect(screen.getByText('Login: needed')).toBeTruthy();
    expect(screen.getByText(/local id 2A/)).toBeTruthy();
  });

  it('a wrong code is rejected, nothing is written, and Remember does not store it', async () => {
    await passatScreen();
    await enterValue('900');
    expect(screen.getByText('Module login')).toBeTruthy();
    await submitLogin('11111', { remember: true });
    await press('Confirm write');
    expect(await screen.findByText(/Login code rejected/)).toBeTruthy();
    expect(await screen.findByText('850rpm')).toBeTruthy();
    expect(useLoginBookStore.getState().byVehicle).toEqual({});
  });

  it('the right code writes and verifies; a code not remembered is not stored', async () => {
    await passatScreen();
    await enterValue('900');
    await submitLogin(SIM_CODE);
    await press('Confirm write');
    expect(await screen.findByText('Write verified.')).toBeTruthy();
    expect(await screen.findByText('900rpm')).toBeTruthy();
    expect(useLoginBookStore.getState().byVehicle).toEqual({});
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain(SIM_CODE);
  });

  it('Remember stores the code in the login book; the next write skips the sheet', async () => {
    await passatScreen();
    await enterValue('900');
    await submitLogin(SIM_CODE, { remember: true });
    await press('Confirm write');
    expect(await screen.findByText('Write verified.')).toBeTruthy();
    const book = useLoginBookStore.getState().byVehicle;
    expect(Object.values(book).flat()).toEqual([
      expect.objectContaining({ address: '01', code: 12345, source: 'user-entered' }),
    ]);
    expect(JSON.stringify(useSettingsStore.getState())).not.toContain(SIM_CODE);
    expect(screen.getByText('Login: remembered (01 · Idle speed adaptation)')).toBeTruthy();

    // Next write: straight to the confirm step. Each write restarts the session (10 85), so the
    // simulated module needs the login again — the app sends the remembered code.
    await enterValue('950');
    expect(screen.queryByText('Module login')).toBeNull();
    await press('Confirm write');
    expect(await screen.findByText('Write verified.')).toBeTruthy();
    expect(await screen.findByText('950rpm')).toBeTruthy();

    await press('Forget');
    expect(useLoginBookStore.getState().byVehicle).toEqual({});
    expect(screen.getByText('Login: needed')).toBeTruthy();
  });

  it('a remembered code the module rejects is forgotten: later writes ask again', async () => {
    useLoginBookStore.setState({
      byVehicle: {
        [SIM_VIN_KEY]: [
          { address: '01', code: 11111, purpose: 'Idle speed adaptation', source: 'user-entered' },
        ],
      },
    });
    await passatScreen();
    await enterValue('900');
    expect(screen.queryByText('Module login')).toBeNull();
    await press('Confirm write');
    expect(await screen.findByText(/Login code rejected/)).toBeTruthy();
    // The stale code is gone from the code book (survives a remount), and never pre-fills.
    expect(useLoginBookStore.getState().byVehicle).toEqual({});
    expect(screen.getByText('Login: needed')).toBeTruthy();

    await enterValue('900');
    expect(screen.getByText('Module login')).toBeTruthy();
    expect(screen.queryByText(/Filled in from this car’s code book/)).toBeNull();
    await submitLogin(SIM_CODE);
    await press('Confirm write');
    expect(await screen.findByText('Write verified.')).toBeTruthy();

    // A successful write with a code not remembered does not bring the stale code back.
    await enterValue('950');
    expect(screen.getByText('Module login')).toBeTruthy();
  });

  it('a code saved before the VIN was known only pre-fills the sheet, and a rejection keeps it', async () => {
    const preVin = {
      'id:passat-b55-19tdi': [
        {
          address: '01',
          code: 11111,
          purpose: 'Idle speed adaptation',
          source: 'user-entered' as const,
        },
      ],
    };
    useLoginBookStore.setState({ byVehicle: preVin });
    await passatScreen();
    expect(
      screen.getByText(/a code saved before this car’s VIN was known is available/),
    ).toBeTruthy();
    expect(screen.queryByText('Forget')).toBeNull();

    // Never sent without the sheet: it opens, pre-filled, and says where the code came from.
    await enterValue('900');
    expect(screen.getByText('Module login')).toBeTruthy();
    expect(
      screen.getByText(/before this car’s VIN was known .* check it is this car’s code/),
    ).toBeTruthy();
    await press('Continue');
    await press('Confirm write');
    expect(await screen.findByText(/Login code rejected/)).toBeTruthy();
    // It may be another car's code: this car's rejection does not delete it.
    expect(useLoginBookStore.getState().byVehicle).toEqual(preVin);
  });
});

describe('AdaptationsScreen — UDS channels (simulated Golf)', () => {
  it('never shows a login step', async () => {
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    useAdaptationsStore.setState({ unlocked: true });
    renderWithProviders(<AdaptationsScreen />);
    expect(screen.queryByText(/Login:/)).toBeNull();
    expect(screen.queryByText(KWP1281_LIMIT)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getAllByText('Read')[0]);
    });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('New value for Idle speed offset'), '900');
    });
    await act(async () => {
      fireEvent.press(screen.getAllByText('Write')[0]);
    });
    expect(screen.queryByText('Module login')).toBeNull();
    await press('Confirm write');
    expect(await screen.findByText('Write verified.')).toBeTruthy();
  });

  it('badges each channel: illustrative, or confirmed once it carries evidence (plan 25)', async () => {
    const [first, second] = getVehicleProfile('golf-plus-2009-20tdi').adaptations!;
    const undo = confirmItems([first]);
    try {
      useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
      await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
      renderWithProviders(<AdaptationsScreen />);
      expect(
        within(screen.getByTestId(`verify-channel-${first.did}`)).getByText(CONFIRMED_TEXT),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId(`verify-channel-${second.did}`)).getByText(ILLUSTRATIVE_TEXT),
      ).toBeTruthy();
      expect(screen.queryByText(/Experimental \/ unverified channel/)).toBeNull();
    } finally {
      undo();
    }
  });
});

describe('AdaptationsScreen — imported label pack (plan 13, simulated Golf)', () => {
  it('shows the imported description for DID 3001; deleting the pack brings the bundled one back', async () => {
    const golf = getVehicleProfile('golf-plus-2009-20tdi');
    const engine = golf.modules!.find((m) => m.reqHeader === '7E0')!;
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    // What a module scan of the simulated Golf leaves behind: the engine's F187 part number.
    useModuleScanStore.setState({
      results: [
        {
          module: engine,
          state: 'ok',
          ident: { partNumber: '03L906022LM', raw: { F187: '03L906022LM' } },
          dtcs: [],
        },
      ],
    });
    renderWithProviders(<AdaptationsScreen />);
    expect(screen.getByText(/^Base idle target adjustment/)).toBeTruthy();

    const text = fs.readFileSync(
      path.resolve(__dirname, '../../../../docs/examples/label-pack.example.json'),
      'utf8',
    );
    const parsed = parseExchangeFile(text);
    if (isParseError(parsed)) throw new Error(parsed.error);
    await act(async () => {
      applyImport(previewImport(parsed), 'create');
    });
    expect(await screen.findByText(/^Example pack: idle target offset/)).toBeTruthy();
    expect(screen.queryByText(/^Base idle target adjustment/)).toBeNull();

    await act(async () => {
      useLabelPackStore.getState().remove('example-edc17-03L906022');
    });
    expect(await screen.findByText(/^Base idle target adjustment/)).toBeTruthy();
  });
});
