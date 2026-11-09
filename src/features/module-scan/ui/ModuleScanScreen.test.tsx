/** Module scan → Discover modules (plan 25) on the simulated Golf: engine, ABS and cluster answer with
 *  their part numbers, the rest stay silent, standard reads still work afterwards; a garage car
 *  keeps a discovered module; the per-module verification badge. */
import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { connectSimulator } from '@test/simulator';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { VAG_UDS_HEADER_CANDIDATES, groupCandidatesByPair } from '@/shared/obd-core';
import { useModuleScanStore } from '../model/moduleScanStore';
import { ModuleScanScreen } from './ModuleScanScreen';
import { DiscoverySection } from './DiscoverySection';

/** One probe per distinct id pair: 08 and 46 share 746/7B0. */
const TOTAL = groupCandidatesByPair(VAG_UDS_HEADER_CANDIDATES).length;

describe('ModuleScanScreen — Discover modules', () => {
  it('finds engine, ABS and cluster on the Golf; the rest stay silent; reads still work', async () => {
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ModuleScanScreen />);

    await act(async () => {
      fireEvent.press(screen.getAllByText('Discover modules')[1]);
    });
    await waitFor(
      () => expect(screen.getByText(`3 of ${TOTAL} addresses answered.`)).toBeTruthy(),
      {
        timeout: 8000,
      },
    );
    expect(within(screen.getByTestId('discovered-01-7E0')).getByText(/03L906022LM/)).toBeTruthy();
    expect(within(screen.getByTestId('discovered-03-760')).getByText(/1K0907379AC/)).toBeTruthy();
    expect(within(screen.getByTestId('discovered-17-714')).getByText(/5M0920861B/)).toBeTruthy();
    // All three are already in the Golf profile's module list.
    expect(screen.getAllByText("Already in this car's module list.")).toHaveLength(3);
    expect(screen.getByText(/^No answer: 02 \(7E1\)/)).toBeTruthy();

    const session = useSessionStore.getState().session;
    const rpm = await session?.readValue('010C');
    expect(rpm?.value ?? 0).toBeGreaterThan(0);
  });

  it('a garage car on the generic base adds a discovered module to its own list', async () => {
    const car = useGarageStore
      .getState()
      .add({ name: 'My Golf', fuel: 'diesel', baseProfileId: 'generic' });
    useVehicleStore.setState({ selectedProfileId: car.id });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ModuleScanScreen />);

    expect(screen.getByText(/No control modules are declared/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getAllByText('Discover modules')[1]);
    });
    await waitFor(
      () => expect(screen.getByText(`3 of ${TOTAL} addresses answered.`)).toBeTruthy(),
      {
        timeout: 8000,
      },
    );
    fireEvent.press(
      within(screen.getByTestId('discovered-01-7E0')).getByText("Add to this car's module list"),
    );
    expect(useGarageStore.getState().vehicles[0].modules).toEqual([
      {
        address: '01',
        name: 'Engine',
        transport: 'uds',
        reqHeader: '7E0',
        rxFilter: '7E8',
        experimental: true,
      },
    ]);
    // The car now has a module list, so the scan itself is offered.
    await waitFor(() => expect(screen.getByText('Scan all modules')).toBeTruthy());
  });

  it('a built-in profile shows the module entry to paste instead', async () => {
    useVehicleStore.setState({ selectedProfileId: 'generic' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ModuleScanScreen />);
    await act(async () => {
      fireEvent.press(screen.getAllByText('Discover modules')[1]);
    });
    await waitFor(
      () => expect(screen.getByText(`3 of ${TOTAL} addresses answered.`)).toBeTruthy(),
      {
        timeout: 8000,
      },
    );
    fireEvent.press(
      within(screen.getByTestId('discovered-03-760')).getByText("Add to this car's module list"),
    );
    expect(screen.getByTestId('discovered-literal').props.children).toContain("reqHeader: '760',");
  });

  it('module rows carry the verification badge', async () => {
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ModuleScanScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Scan all modules'));
    });
    await waitFor(() => expect(screen.getByText(/^Last scan/)).toBeTruthy(), { timeout: 8000 });
    fireEvent.press(screen.getByText('Engine (EDC17)'));
    expect(
      within(screen.getByTestId('verify-module-uds:01')).getByText('Standard OBD2'),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('ABS/ESP (MK60)'));
    expect(
      within(screen.getByTestId('verify-module-uds:03')).getByText(
        'Illustrative — not yet confirmed on this car',
      ),
    ).toBeTruthy();
  });

  it('keeps a UDS and a TP2.0 module with the same address as separate rows', async () => {
    // The Golf lists the cluster 17 on UDS (714/77E) and on TP2.0: one result each, never merged.
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ModuleScanScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Scan all modules'));
    });
    await waitFor(() => expect(screen.getByText(/^Last scan/)).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText('Instrument cluster')).toBeTruthy();
    expect(screen.getByText('Instrument cluster (TP2.0)')).toBeTruthy();
    const results = useModuleScanStore.getState().results;
    expect(results.filter((r) => r.module.address === '17').map((r) => r.state)).toEqual([
      'ok',
      'skipped',
    ]);
    // Both expanded: each row's verification badge has its own testID (keyed by transport too).
    fireEvent.press(screen.getByText('Instrument cluster'));
    fireEvent.press(screen.getByText('Instrument cluster (TP2.0)'));
    expect(screen.getByTestId('verify-module-uds:17')).toBeTruthy();
    expect(screen.getByTestId('verify-module-tp20:17')).toBeTruthy();
  });

  it('is not offered on 29-bit CAN, where addressing could not be restored afterwards', async () => {
    useVehicleStore.setState({ selectedProfileId: 'generic' });
    await connectSimulator({ vehicleId: 'generic' });
    const session = useSessionStore.getState().session!;
    // No 29-bit simulator profile exists; flip the detected protocol the session reports.
    (session as unknown as { protocol: string }).protocol = 'ISO_15765_4_CAN_29_500';
    renderWithProviders(<ModuleScanScreen />);
    expect(screen.queryByText('Discover modules')).toBeNull();
    expect(screen.queryByText(/Discover modules below/)).toBeNull();
  });

  it('a shared id pair (08 / 46) is one row whose address the user can switch before adding', () => {
    const [hvac, comfort] = ['08', '46'].map(
      (a) => VAG_UDS_HEADER_CANDIDATES.find((c) => c.address === a)!,
    );
    const onAdd = jest.fn();
    renderWithProviders(
      <DiscoverySection
        discover={async () => {}}
        addDiscovered={onAdd}
        isGarageCar
        modules={[]}
        discovery={[
          {
            candidate: hvac,
            alternatives: [comfort],
            ident: { systemName: 'Steuergeraet', raw: { F197: 'Steuergeraet' } },
            state: 'answered',
            ms: 40,
          },
        ]}
      />,
    );
    const row = within(screen.getByTestId('discovered-08-746'));
    expect(row.getByText(/Addresses 08 and 46 share these CAN ids/)).toBeTruthy();
    fireEvent.press(row.getByText('Record as 46 Central conv. (comfort) instead'));
    expect(row.getByText('Central conv. (comfort)')).toBeTruthy();
    fireEvent.press(row.getByText("Add to this car's module list"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].candidate.address).toBe('46');
    expect(onAdd.mock.calls[0][0].alternatives.map((c: { address: string }) => c.address)).toEqual([
      '08',
    ]);
  });

  it('drops a discovery made on another car instead of offering it to the new one', async () => {
    const car = useGarageStore
      .getState()
      .add({ name: 'My Golf', fuel: 'diesel', baseProfileId: 'generic' });
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    await connectSimulator({ vehicleId: 'golf-plus-2009-20tdi' });
    renderWithProviders(<ModuleScanScreen />);
    await act(async () => {
      fireEvent.press(screen.getAllByText('Discover modules')[1]);
    });
    await waitFor(
      () => expect(screen.getByText(`3 of ${TOTAL} addresses answered.`)).toBeTruthy(),
      { timeout: 8000 },
    );
    // Switch to the garage car: the Golf's rows disappear and cannot be added to it.
    act(() => {
      useVehicleStore.setState({ selectedProfileId: car.id });
    });
    await waitFor(() => expect(useModuleScanStore.getState().discovery).toBeNull());
    expect(screen.queryByText(/addresses answered\./)).toBeNull();
    expect(screen.queryByText("Add to this car's module list")).toBeNull();
    expect(useGarageStore.getState().vehicles[0].modules).toBeUndefined();
  });
});
