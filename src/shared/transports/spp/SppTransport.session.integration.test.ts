/** End to end without hardware (plan 27): a `DiagnosticSession` over `SppTransport`, whose fake
 *  Classic Bluetooth device plays an ELM327 through the shared test bridge (`bridgeToMock`). The
 *  device re-chunks the simulator's output by `>` and strips it, exactly as
 *  `react-native-bluetooth-classic` does with `delimiter: '>'` — so identify and the DTC read only
 *  work if the transport puts every prompt back. */

import { SppTransport } from './SppTransport';
import { FakeSppModule, sppDeviceOverBridge, type FakeSppDevice } from './testing/fakeSppModule';
import { bridgeToMock } from '../../obd-core/transport/testing/bridge';
import { buildScenario } from '../../obd-core/transport/scenarios';
import { MONITOR_UNAVAILABLE_MESSAGE } from '../../obd-core/transport/Transport';
import { DiagnosticSession } from '../../obd-core/session/DiagnosticSession';
import { getVehicleProfile } from '../../vehicles';

const GOLF = 'golf-plus-2009-20tdi';
const ADDR = '00:1D:A5:68:98:8B';

function sppGolf(overrides: Parameters<typeof buildScenario>[1] = {}) {
  const devices: FakeSppDevice[] = [];
  const mod = new FakeSppModule(() => {
    const device = sppDeviceOverBridge(bridgeToMock(buildScenario(GOLF, overrides)));
    devices.push(device);
    return device;
  });
  const transport = new SppTransport(ADDR, async () => mod);
  const session = new DiagnosticSession(transport, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  return { transport, session, devices };
}

describe('DiagnosticSession over SppTransport (delimiter-chunked Golf simulator)', () => {
  it('connects, identifies the car and reads its PIDs', async () => {
    const { transport, session, devices } = sppGolf();
    const info = await session.connect();
    expect(transport.status).toBe('connected');
    expect(info.protocol).toBe('ISO_15765_4_CAN_11_500');
    expect(info.vin).toHaveLength(17);
    const golf = getVehicleProfile(GOLF);
    expect([...info.supportedPids].sort()).toEqual([...golf.supportedPids].sort());
    // The init went over the link as plain ELM327 text.
    const sent = devices[0].written.map((w) => w.trim());
    expect(sent).toContain('ATZ');
    expect(sent).toContain('0100');

    const rpm = await session.readValue('010C');
    expect(rpm?.value).toBeCloseTo(820, 0);
    await session.disconnect();
    expect(transport.status).toBe('disconnected');
    expect(devices[0].disconnects).toBe(1);
  });

  it('reads stored DTCs (mode 03)', async () => {
    const { session } = sppGolf({ storedDtcs: ['P0299', 'P0401'] });
    await session.connect();
    const stored = await session.readDtcs('03');
    expect(stored.map((d) => d.code).sort()).toEqual(['P0299', 'P0401']);
    await session.disconnect();
  });

  it('refuses to start the sniffer and leaves the link usable', async () => {
    const { session, devices } = sppGolf();
    await session.connect();
    expect(session.canMonitor).toBe(false);
    const before = devices[0].written.length;
    await expect(session.startSniffer(() => undefined)).rejects.toThrow(
      MONITOR_UNAVAILABLE_MESSAGE,
    );
    // Nothing was sent (no ATH1 / ATMA) and the command queue is not held.
    expect(devices[0].written).toHaveLength(before);
    expect(session.sniffing).toBe(false);
    const rpm = await session.readValue('010C');
    expect(rpm?.value).toBeCloseTo(820, 0);
    await session.disconnect();
  });
});
