/** End to end without hardware (plan 26): a `DiagnosticSession` over `TcpTransport`, whose fake
 *  socket plays a Wi-Fi ELM327 through the shared test bridge (`bridgeToMock`) — the simulated Golf
 *  answers every byte the transport sends. Proves the whole stack above the transport is unchanged. */

import { TcpTransport, type TcpSocketFactory } from './TcpTransport';
import { DEFAULT_WIFI_ENDPOINT } from './endpoint';
import { socketOverBridge } from './testing/fakeSocket';
import { bridgeToMock } from '../../obd-core/transport/testing/bridge';
import { buildScenario } from '../../obd-core/transport/scenarios';
import { DiagnosticSession } from '../../obd-core/session/DiagnosticSession';
import { getVehicleProfile } from '../../vehicles';
import { bytesToString } from '../../lib/bytes';

const GOLF = 'golf-plus-2009-20tdi';

function wifiGolf(overrides: Parameters<typeof buildScenario>[1] = {}) {
  const sockets: ReturnType<typeof socketOverBridge>[] = [];
  const factory: TcpSocketFactory = async () => {
    const socket = socketOverBridge(bridgeToMock(buildScenario(GOLF, overrides)));
    sockets.push(socket);
    return socket;
  };
  const transport = new TcpTransport(DEFAULT_WIFI_ENDPOINT, factory);
  const session = new DiagnosticSession(transport, {
    commandTimeoutMs: 1000,
    firstCommandTimeoutMs: 1000,
  });
  return { transport, session, sockets };
}

describe('DiagnosticSession over TcpTransport (bridged Golf simulator)', () => {
  it('connects, identifies the car and reads its PIDs', async () => {
    const { transport, session, sockets } = wifiGolf();
    const info = await session.connect();
    expect(transport.status).toBe('connected');
    expect(info.protocol).toBe('ISO_15765_4_CAN_11_500');
    expect(info.vin).toHaveLength(17);
    const golf = getVehicleProfile(GOLF);
    expect(info.supportedPids).toHaveLength(16);
    expect([...info.supportedPids].sort()).toEqual([...golf.supportedPids].sort());
    // The init went over the socket as plain ELM327 text.
    const sent = sockets[0].written.map((b) => bytesToString(b).trim());
    expect(sent).toContain('ATZ');
    expect(sent).toContain('0100');

    const rpm = await session.readValue('010C');
    expect(rpm?.value).toBeCloseTo(820, 0);
    await session.disconnect();
    expect(transport.status).toBe('disconnected');
    expect(sockets[0].destroyed).toBe(1);
  });

  it('reads stored DTCs (mode 03)', async () => {
    const { session } = wifiGolf({ storedDtcs: ['P0299', 'P0401'] });
    await session.connect();
    const stored = await session.readDtcs('03');
    expect(stored.map((d) => d.code).sort()).toEqual(['P0299', 'P0401']);
    await session.disconnect();
  });
});
