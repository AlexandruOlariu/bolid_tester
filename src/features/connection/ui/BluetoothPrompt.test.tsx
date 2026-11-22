/** The radio-state banner on the Connect screen, per platform (plan 09): iOS reports a denied
 *  Bluetooth prompt as ble-plx `State.Unauthorized` and has no API to turn the radio on, so the
 *  banner deep-links to the app's Settings page and never offers "Turn on Bluetooth" there. */
import React from 'react';
import { Linking, Platform } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { State } from 'react-native-ble-plx';
import { renderWithProviders } from '@test/renderWithProviders';
import type { BluetoothState } from '../hooks/useBluetoothState';
import { BluetoothPrompt } from './BluetoothPrompt';

function bt(state: State): BluetoothState {
  return {
    state,
    ready: state === State.PoweredOn,
    poweredOff: state === State.PoweredOff,
    unauthorized: state === State.Unauthorized,
    unsupported: state === State.Unsupported,
    checking: state === State.Unknown || state === State.Resetting,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('BluetoothPrompt', () => {
  it('renders nothing while ready or still settling', () => {
    renderWithProviders(<BluetoothPrompt bt={bt(State.PoweredOn)} />);
    expect(screen.queryByText(/Bluetooth/)).toBeNull();
    renderWithProviders(<BluetoothPrompt bt={bt(State.Unknown)} />);
    expect(screen.queryByText(/Bluetooth/)).toBeNull();
  });

  it('on iOS, a denied permission deep-links to Settings with iOS wording', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    renderWithProviders(<BluetoothPrompt bt={bt(State.Unauthorized)} />);

    expect(screen.getByText('Bluetooth permission needed')).toBeTruthy();
    expect(screen.getByText(/Allow Bluetooth for Bolid Tester in Settings/)).toBeTruthy();
    expect(screen.queryByText(/Nearby devices/)).toBeNull();
    fireEvent.press(screen.getByText('Open settings'));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('on Android, a denied permission names “Nearby devices” and opens settings too', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    renderWithProviders(<BluetoothPrompt bt={bt(State.Unauthorized)} />);

    expect(screen.getByText(/Nearby devices/)).toBeTruthy();
    fireEvent.press(screen.getByText('Open settings'));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('on iOS, a powered-off radio points to Control Center with no Turn-on button', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    renderWithProviders(<BluetoothPrompt bt={bt(State.PoweredOff)} />);

    expect(screen.getByText('Bluetooth is off')).toBeTruthy();
    expect(screen.getByText(/Control Center/)).toBeTruthy();
    expect(screen.queryByText('Turn on Bluetooth')).toBeNull();
  });

  it('on Android, a powered-off radio offers the one-tap Turn on Bluetooth', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    renderWithProviders(<BluetoothPrompt bt={bt(State.PoweredOff)} />);

    expect(screen.getByText('Turn on Bluetooth')).toBeTruthy();
    expect(screen.queryByText(/Control Center/)).toBeNull();
  });
});
