/** The connection feature's service layer: builds the right Transport (mock or BLE), wires the
 *  adapter I/O log, runs the DiagnosticSession, and updates the shared stores.
 *  Note: "api" here means device/engine access, not a network API. */

import { Transport } from '@/shared/obd-core/transport/Transport';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { DiagnosticSession } from '@/shared/obd-core/session/DiagnosticSession';
import { bytesToString } from '@/shared/lib/bytes';
import { BleTransport } from '@/shared/transports/ble/BleTransport';
import { getBleManager } from '@/shared/transports/ble/manager';
import { requestBlePermissions } from '@/shared/transports/ble/permissions';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';

/** Tap the transport to mirror every command/response into the in-app log. */
function withLog(inner: Transport): Transport {
  const append = useSettingsStore.getState().appendLog;
  return {
    get status() {
      return inner.status;
    },
    connect: () => inner.connect(),
    disconnect: () => inner.disconnect(),
    write: (bytes) => {
      append({ dir: 'tx', text: bytesToString(bytes).replace(/[\r\n]/g, '').trim(), ts: Date.now() });
      return inner.write(bytes);
    },
    onData: (listener) =>
      inner.onData((bytes) => {
        append({ dir: 'rx', text: bytesToString(bytes).replace(/[\r\n>]/g, ' ').trim(), ts: Date.now() });
        listener(bytes);
      }),
  };
}

export interface ConnectTarget {
  deviceId: string;
  deviceName?: string;
}

export async function connect(target?: ConnectTarget): Promise<void> {
  const { adapterSource, simulatedVehicleId, injectedDtcs } = useSettingsStore.getState();
  const store = useSessionStore.getState();
  store.setError(null);
  store.setStatus('connecting');

  try {
    let transport: Transport;
    let device: { id: string | null; name: string | null };

    if (adapterSource === 'ble') {
      if (!target) throw new Error('Select a Bluetooth device first');
      if (!(await requestBlePermissions())) throw new Error('Bluetooth permission denied');
      transport = new BleTransport(getBleManager(), target.deviceId);
      device = { id: target.deviceId, name: target.deviceName ?? null };
    } else {
      transport = new MockTransport(buildScenario(simulatedVehicleId, { storedDtcs: injectedDtcs }));
      device = { id: 'mock', name: `Simulator · ${simulatedVehicleId}` };
    }

    const session = new DiagnosticSession(withLog(transport), {
      commandTimeoutMs: 5000,
      firstCommandTimeoutMs: 12000,
    });
    store.setStatus('initializing');
    const info = await session.connect();
    useSessionStore.getState().setConnected(session, info, device);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useSessionStore.getState().setStatus('error');
    useSessionStore.getState().setError(message);
    throw e;
  }
}

export async function disconnect(): Promise<void> {
  const { session } = useSessionStore.getState();
  await session?.disconnect();
  useSessionStore.getState().reset();
}
