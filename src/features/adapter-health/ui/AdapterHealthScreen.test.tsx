/** Simulator → Adapter health → Share JSON (plan 29 acceptance): the run grades the simulated
 *  adapter, the screen says there are no community reports for it, and the JSON share hands a
 *  schema-v1 report (link "mock") to the save / share path. */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { validateAdapterReport } from '@/shared/adapters';
import { saveTextFile } from '@/shared/lib/saveFile';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useLinkStore } from '@/shared/state/linkStore';
import { useAdapterHealthStore } from '../model/adapterHealthStore';
import { AdapterHealthScreen } from './AdapterHealthScreen';

jest.mock('@/shared/lib/saveFile', () => ({
  ...jest.requireActual('@/shared/lib/saveFile'),
  saveTextFile: jest.fn(async () => undefined),
}));
const save = saveTextFile as jest.MockedFunction<typeof saveTextFile>;

describe('AdapterHealthScreen', () => {
  it('runs on the simulator and shares a JSON report for the matrix', async () => {
    await connectSimulator();
    renderWithProviders(<AdapterHealthScreen />);

    fireEvent.press(screen.getByText('Run health check (~5 s)'));
    expect(
      await screen.findByText('Share JSON (for the compatibility matrix)', {}, { timeout: 10000 }),
    ).toBeTruthy();
    expect(
      screen.getByText('No community reports for this adapter yet — share the JSON to add one.'),
    ).toBeTruthy();

    fireEvent.press(screen.getByText('Share JSON (for the compatibility matrix)'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [name, body, mime] = save.mock.calls[0];
    expect(name).toMatch(/^simulator-golf-plus-2009-20tdi__elm327-v2-2__\d{4}-\d{2}-\d{2}\.json$/);
    expect(mime).toBe('application/json');
    const json = JSON.parse(body);
    expect(json.schema).toBe(1);
    expect(json.adapter).toMatchObject({ firmware: 'ELM327 v2.2', link: 'mock' });
    expect(json.vehicle).toEqual({ profileId: 'generic', protocol: expect.stringMatching(/CAN/) });
    expect(validateAdapterReport(json, { allowMock: true })).toEqual([]);

    fireEvent.press(screen.getByText('Share as text'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatch(/^adapter-health-.*\.txt$/);
    expect(save.mock.calls[1][2]).toBe('text/plain');
  });

  it('leaving the screen mid-run does not leave the check stuck as running', async () => {
    await connectSimulator();
    const first = renderWithProviders(<AdapterHealthScreen />);
    fireEvent.press(screen.getByText('Run health check (~5 s)'));
    await waitFor(() => expect(useAdapterHealthStore.getState().running).toBe(true));
    first.unmount();

    // The cut-short run settles: the global store is idle again and keeps no partial report.
    await waitFor(() => expect(useAdapterHealthStore.getState().running).toBe(false), {
      timeout: 10000,
    });
    expect(useAdapterHealthStore.getState().phase).toBeNull();
    expect(useAdapterHealthStore.getState().report).toBeNull();

    // A fresh mount can run again.
    renderWithProviders(<AdapterHealthScreen />);
    fireEvent.press(screen.getByText('Run health check (~5 s)'));
    expect(
      await screen.findByText('Share JSON (for the compatibility matrix)', {}, { timeout: 10000 }),
    ).toBeTruthy();
  });

  it('shares the adapter the run was made on, not the one connected at share time', async () => {
    await connectSimulator();
    renderWithProviders(<AdapterHealthScreen />);
    fireEvent.press(screen.getByText('Run health check (~5 s)'));
    expect(
      await screen.findByText('Share JSON (for the compatibility matrix)', {}, { timeout: 10000 }),
    ).toBeTruthy();

    // The kept report outlives a reconnect to a real Bluetooth LE adapter.
    useSessionStore.setState({ deviceName: 'IOS-Vlink' });
    useLinkStore.setState({
      kind: 'ble',
      link: { service: 'fff0', writeWithoutResponse: true, mtu: 185 } as never,
    });
    save.mockClear();
    fireEvent.press(screen.getByText('Share JSON (for the compatibility matrix)'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const json = JSON.parse(save.mock.calls[0][1]);
    expect(json.adapter.link).toBe('mock');
    expect(json.adapter.deviceName).not.toBe('IOS-Vlink');
    expect(json.adapter.mtu).toBeUndefined();
    // Still a simulator report, so the matrix build refuses it.
    expect(validateAdapterReport(json).some((p) => p.includes('mock'))).toBe(true);
  });
});
