/** Connect the real `connectionService` to the simulator (`MockTransport`) for a component test, the
 *  same path the Connect tab's **Connect to simulator** button takes. The session it publishes is
 *  closed again by the `afterEach` in jest.setup.ui.ts. */
import { act } from '@testing-library/react-native';
import { connect } from '@/features/connection/api/connectionService';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useLiveDataStore } from '@/shared/state/liveDataStore';

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

/** Let the EngineHost poll loop's first sweep land inside `act()`. Rendering `<EngineHost />` starts
 *  the loop, whose first sweep resolves a few simulator round-trips later; a test that ends straight
 *  after rendering would otherwise see that sweep re-render the mounted screen outside `act()`
 *  ("An update to … was not wrapped in act"). The next sweep is a full poll interval (1 s) away, so
 *  a short synchronous test then ends — and its tree is unmounted — before anything else updates. */
export async function settleFirstPollSweep(timeoutMs = 4000): Promise<void> {
  await act(
    () =>
      new Promise<void>((resolve, reject) => {
        const swept = () => Object.keys(useLiveDataStore.getState().values).length > 0;
        if (swept()) return resolve();
        const timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`No poll sweep published within ${timeoutMs} ms`));
        }, timeoutMs);
        const unsubscribe = useLiveDataStore.subscribe(() => {
          if (!swept()) return;
          clearTimeout(timer);
          unsubscribe();
          resolve();
        });
      }),
  );
}
