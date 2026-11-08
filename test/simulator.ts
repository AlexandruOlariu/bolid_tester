/** Connect the real `connectionService` to the simulator (`MockTransport`) for a component test, the
 *  same path the Connect tab's **Connect to simulator** button takes. The session it publishes is
 *  closed again by the `afterEach` in jest.setup.ui.ts. */
import { act } from '@testing-library/react-native';
import { connect } from '@/features/connection/api/connectionService';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';

export interface SimulatorOptions {
  /** Scenario / profile id the simulator emulates (default: the Golf Plus). */
  vehicleId?: string;
  /** Stored codes the simulated ECU reports (Settings → Injected DTCs). */
  injectedDtcs?: string[];
}

export async function connectSimulator(opts: SimulatorOptions = {}): Promise<void> {
  useSettingsStore.setState({
    adapterSource: 'mock',
    simulatedVehicleId: opts.vehicleId ?? 'golf-plus-2009-20tdi',
    injectedDtcs: opts.injectedDtcs ?? [],
  });
  await act(async () => {
    await connect();
  });
  const { status, error } = useSessionStore.getState();
  if (status !== 'connected')
    throw new Error(`Simulator did not connect: ${status} ${error ?? ''}`);
}
