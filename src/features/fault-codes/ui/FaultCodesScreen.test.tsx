import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { mockPush } from '@test/mocks/router';
import { FaultCodesScreen } from './FaultCodesScreen';

describe('FaultCodesScreen', () => {
  it('says "Not connected." without a session', async () => {
    renderWithProviders(<FaultCodesScreen />);
    // Let the mount-time read settle (no session → it just empties the list).
    await act(async () => undefined);
    expect(screen.getByText('Not connected.')).toBeTruthy();
  });

  it('reads two stored codes from the simulator with descriptions and readiness', async () => {
    await connectSimulator({ injectedDtcs: ['P0299', 'P0401'] });
    renderWithProviders(<FaultCodesScreen />);

    expect(await screen.findByText('P0299')).toBeTruthy();
    expect(screen.getByText('P0401')).toBeTruthy();
    expect(screen.getByText('Turbocharger/Supercharger A Underboost Condition')).toBeTruthy();
    expect(
      screen.getByText('Exhaust Gas Recirculation "A" Flow Insufficient Detected'),
    ).toBeTruthy();
    expect(screen.getByText('Stored (2)')).toBeTruthy();
    expect(screen.getByText('Readiness')).toBeTruthy();
    expect(screen.getByText('MIL ON')).toBeTruthy();
  });

  it('expands the inline guide for a code', async () => {
    await connectSimulator({ injectedDtcs: ['P0299'] });
    renderWithProviders(<FaultCodesScreen />);
    await screen.findByText('P0299');

    expect(screen.queryByText('Hide guide')).toBeNull();
    fireEvent.press(screen.getByText('Guide'));
    expect(screen.getByText('Hide guide')).toBeTruthy();
  });

  it('opens the full vehicle report from "Full report"', async () => {
    await connectSimulator({ injectedDtcs: ['P0299'] });
    renderWithProviders(<FaultCodesScreen />);
    await screen.findByText('P0299');

    fireEvent.press(screen.getByText('Full report'));
    expect(mockPush).toHaveBeenCalledWith('/report');
  });

  it('clears the codes after the confirmation and re-reads an empty list', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await connectSimulator({ injectedDtcs: ['P0299'] });
    renderWithProviders(<FaultCodesScreen />);
    await screen.findByText('P0299');

    fireEvent.press(screen.getByText('Clear codes'));
    expect(alert).toHaveBeenCalledWith('Clear fault codes?', expect.any(String), expect.any(Array));
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    const confirm = buttons.find((b) => b.text === 'Clear');
    expect(confirm).toBeDefined();
    await act(async () => {
      confirm?.onPress?.();
    });

    expect(await screen.findByText('Stored (0)')).toBeTruthy();
    expect(screen.queryByText('P0299')).toBeNull();
    expect(screen.getAllByText('None')).toHaveLength(3);
    alert.mockRestore();
  });
});
