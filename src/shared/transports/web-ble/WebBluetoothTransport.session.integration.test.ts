/** End to end without hardware (plan 28): a `DiagnosticSession` over `WebBluetoothTransport`, whose
 *  fake GATT plays a BLE ELM327 through the shared test bridge (`bridgeToMock`, plan 26) — writes to
 *  FFF2 reach the simulated Golf, its replies come back as 20-byte FFF1 notifications. Proves the
 *  stack above the transport is unchanged on the web. */

import { WebBluetoothTransport } from './WebBluetoothTransport';
import { FakeWebBluetooth, webDeviceOverBridge } from './testing/fakeWebBluetooth';
import { bridgeToMock } from '../../obd-core/transport/testing/bridge';
import { buildScenario } from '../../obd-core/transport/scenarios';
import { DiagnosticSession } from '../../obd-core/session/DiagnosticSession';
import { getVehicleProfile } from '../../vehicles';
import { bytesToString } from '../../lib/bytes';

const GOLF = 'golf-plus-2009-20tdi';

async function webGolf(overrides: Parameters<typeof buildScenario>[1] = {}) {
  const device = webDeviceOverBridge(bridgeToMock(buildScenario(GOLF, overrides)));
  const picked = await WebBluetoothTransport.pickDevice(new FakeWebBluetooth(device));
  const transport = new WebBluetoothTransport(picked);
  const session = new DiagnosticSession(transport, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  const write = device.gatt.services[1].characteristics[1];
  return { device, transport, session, write };
}

describe('DiagnosticSession over WebBluetoothTransport (bridged Golf simulator)', () => {
  it('connects, identifies the car and reads its PIDs', async () => {
    const { transport, session, write, device } = await webGolf();
    const info = await session.connect();
    expect(transport.status).toBe('connected');
    expect(transport.linkInfo?.payload).toBe(20);
    expect(info.protocol).toBe('ISO_15765_4_CAN_11_500');
    expect(info.vin).toHaveLength(17);
    const golf = getVehicleProfile(GOLF);
    expect([...info.supportedPids].sort()).toEqual([...golf.supportedPids].sort());
    // Plain ELM327 text over GATT, never more than 20 bytes per write.
    const sent = write.writes.map((w) => bytesToString(Uint8Array.from(w.bytes)).trim());
    expect(sent).toContain('ATZ');
    expect(sent).toContain('0100');
    expect(Math.max(...write.writes.map((w) => w.bytes.length))).toBeLessThanOrEqual(20);

    const rpm = await session.readValue('010C');
    expect(rpm?.value).toBeCloseTo(820, 0);
    await session.disconnect();
    expect(transport.status).toBe('disconnected');
    expect(device.gatt.connected).toBe(false);
  });

  it('reads stored DTCs (mode 03)', async () => {
    const { session } = await webGolf({ storedDtcs: ['P0299', 'P0401'] });
    await session.connect();
    const stored = await session.readDtcs('03');
    expect(stored.map((d) => d.code).sort()).toEqual(['P0299', 'P0401']);
    await session.disconnect();
  });
});
