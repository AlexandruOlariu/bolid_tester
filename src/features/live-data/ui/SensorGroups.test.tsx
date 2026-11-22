import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { setMockWindow } from '@test/mocks/window';
import { connectSimulator } from '@test/simulator';
import type { LiveValue } from '@/shared/obd-core/session/DiagnosticSession';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';
import { SensorGroups } from './SensorGroups';

async function golfSession() {
  await connectSimulator();
  useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
  const session = useSessionStore.getState().session;
  if (!session) throw new Error('no session');
  return session;
}

/** Makes the next `readExtended` call hang until the returned `release` is called. */
function holdNextRead(spy: jest.SpyInstance<Promise<number[] | null>, [string]>) {
  let release: (raw: number[] | null) => void = () => {};
  spy.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  return (raw: number[] | null) => release(raw);
}

function live(pid: string, name: string, unit: string, value: number): LiveValue {
  return { pid, name, unit, value, ts: 0 };
}

/** Live → All sensors (plan 07; was the Sensor readings screen). */
describe('SensorGroups', () => {
  it('reads the injection DIDs once on mount, not again on every live-data update', async () => {
    await connectSimulator();
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    const session = useSessionStore.getState().session;
    if (!session) throw new Error('no session');
    const readExtended = jest.spyOn(session, 'readExtended');

    renderWithProviders(<SensorGroups />);
    expect(await screen.findByText('Injection quantity')).toBeTruthy();
    expect(readExtended).toHaveBeenCalledTimes(5);

    // A poll update re-renders the screen; that must not start another round of Mode 22 reads.
    for (const rpm of [820, 830, 840]) {
      await act(async () => {
        useLiveDataStore.setState({ values: { '010C': live('010C', 'Engine RPM', 'rpm', rpm) } });
      });
    }
    expect(screen.getByText('Engine')).toBeTruthy();
    expect(readExtended).toHaveBeenCalledTimes(5);
  });

  it('a read superseded by Refresh stops and never overwrites the newer values', async () => {
    const session = await golfSession();
    const readExtended = jest.spyOn(session, 'readExtended');
    const release = holdNextRead(readExtended);

    renderWithProviders(<SensorGroups />);
    expect(readExtended).toHaveBeenCalledTimes(1); // first run is stuck on its first DID
    fireEvent.press(screen.getByText('Refresh'));
    expect(await screen.findByText('Injection quantity')).toBeTruthy();
    expect(readExtended).toHaveBeenCalledTimes(6);

    // The stale run wakes up: it must not send its remaining four DIDs or replace the values.
    await act(async () => release(null));
    expect(readExtended).toHaveBeenCalledTimes(6);
    expect(screen.getByText('Injection quantity')).toBeTruthy();
  });

  it('never lists extended 22:<DID> live values among the standard sensors', async () => {
    await golfSession();
    renderWithProviders(<SensorGroups />);
    expect(await screen.findByText('Injection quantity')).toBeTruthy();
    await act(async () => {
      useLiveDataStore.setState({
        values: {
          '0142': live('0142', 'Control module voltage', 'V', 14.1),
          '01A6': live('01A6', 'Odometer', 'km', 1000),
          '22:1701': live('22:1701', 'DPF soot mass (calc.)', 'g', 12),
        },
      });
    });
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.getByText('Odometer')).toBeTruthy();
    expect(screen.queryByText('DPF soot mass (calc.)')).toBeNull();
  });

  it('stops reading DIDs once the screen unmounts', async () => {
    const session = await golfSession();
    const readExtended = jest.spyOn(session, 'readExtended');
    const release = holdNextRead(readExtended);

    const { unmount } = renderWithProviders(<SensorGroups />);
    expect(readExtended).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => release(null));
    expect(readExtended).toHaveBeenCalledTimes(1);
  });
  // Plan 20: above 1.5× OS font scale two 150 dp tiles cannot hold the number and its unit.
  describe('large text', () => {
    const widthOf = (label: RegExp) => {
      let node = screen.getByLabelText(label);
      while (!node.props.accessibilityLabel) node = node.parent!;
      const style = [node.props.style].flat(Infinity) as { width?: number | string }[];
      return style.reduce<number | string | undefined>((w, s) => s?.width ?? w, undefined);
    };
    const renderWithVoltage = async () => {
      await connectSimulator();
      renderWithProviders(<SensorGroups />);
      await act(async () => {
        useLiveDataStore.setState({
          values: { '0142': live('0142', 'Control module voltage', 'V', 14.1) },
        });
      });
    };

    it('the sensor cards go full width, one per row', async () => {
      setMockWindow({ fontScale: 2 });
      await renderWithVoltage();
      expect(widthOf(/^Control module voltage: 14 V/)).toBe('100%');
    });

    it('normal text keeps the wrapping 150 dp minimum', async () => {
      setMockWindow({ fontScale: 1.3 });
      await renderWithVoltage();
      expect(widthOf(/^Control module voltage: 14 V/)).toBeUndefined();
    });
  });
});
