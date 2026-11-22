/** SppTransport (plan 27) against a fake `react-native-bluetooth-classic`: status transitions, the
 *  re-appended ELM327 prompt, drop / manual-disconnect handling, the monitor capability and the
 *  bonded-device list. */

import {
  SppTransport,
  SppConnectCancelledError,
  SPP_MODULE_MISSING,
  defaultSppModule,
  listBondedAdapters,
  type SppDeviceLike,
} from './SppTransport';
import { FakeSppDevice, FakeSppModule } from './testing/fakeSppModule';
import { bytesToString, stringToBytes } from '../../lib/bytes';
import type { TransportStatus } from '../../obd-core/transport/Transport';
import { canStreamMonitor } from '../../obd-core/transport/Transport';

const ADDR = '00:1D:A5:68:98:8B';

function setup(makeDevice?: (address: string) => SppDeviceLike | Promise<SppDeviceLike>) {
  const device = new FakeSppDevice();
  const mod = new FakeSppModule(makeDevice ?? (() => device));
  const transport = new SppTransport(ADDR, async () => mod);
  const statuses: TransportStatus[] = [];
  transport.onStatusChange((s) => statuses.push(s));
  const received: string[] = [];
  transport.onData((b) => received.push(bytesToString(b)));
  return { device, mod, transport, statuses, received };
}

describe('SppTransport', () => {
  it('connects with the ELM327 prompt as the delimiter and reports connected', async () => {
    const { mod, transport, statuses } = setup();
    await transport.connect();
    expect(transport.status).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(mod.connects).toEqual([{ address: ADDR, opts: { delimiter: '>', charset: 'ascii' } }]);
  });

  it('re-appends the stripped prompt to every message', async () => {
    const { device, transport, received } = setup();
    await transport.connect();
    device.emitData('41 0C 0C D0\r\r');
    device.emitData('');
    expect(received).toEqual(['41 0C 0C D0\r\r>', '>']);
  });

  it('writes the command bytes as an ASCII string', async () => {
    const { device, transport } = setup();
    await transport.connect();
    await transport.write(stringToBytes('010C\r'));
    expect(device.written).toEqual(['010C\r']);
  });

  it('fails any write before connecting', async () => {
    const { transport } = setup();
    await expect(transport.write(stringToBytes('ATZ\r'))).rejects.toThrow(/not connected/);
  });

  it('a write the library reports as not sent is a drop: disconnected, socket closed', async () => {
    const { device, transport, statuses } = setup();
    await transport.connect();
    device.writeResult = false;
    await expect(transport.write(stringToBytes('ATZ\r'))).rejects.toThrow(/write failed/);
    expect(transport.status).toBe('disconnected');
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    expect(device.disconnects).toBe(1);
  });

  it('a rejected write ("Not connected to <MAC>") is a drop, reported once', async () => {
    const { device, mod, transport, statuses } = setup();
    await transport.connect();
    device.writeError = new Error(`Not connected to ${ADDR}`);
    await expect(transport.write(stringToBytes('010C\r'))).rejects.toThrow(
      `Classic Bluetooth write failed: Not connected to ${ADDR}`,
    );
    expect(transport.status).toBe('disconnected');
    // Later commands fail fast; the late ACL event is no second drop.
    await expect(transport.write(stringToBytes('010C\r'))).rejects.toThrow(/not connected/);
    mod.emitDisconnected(ADDR);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    expect(device.listenerCount).toBe(0);
    expect(mod.disconnectListenerCount).toBe(0);
  });

  it('turns a connect failure into status error with the socket error in the message', async () => {
    const { transport, statuses } = setup(() => {
      throw new Error('read failed, socket might closed or timeout, read ret: -1');
    });
    await expect(transport.connect()).rejects.toThrow(
      `Could not open the Classic Bluetooth adapter ${ADDR}: read failed, socket might closed`,
    );
    expect(transport.status).toBe('error');
    expect(statuses).toEqual(['connecting', 'error']);
  });

  it('fails with status error when the module is absent', async () => {
    const transport = new SppTransport(ADDR, async () => {
      throw new Error(SPP_MODULE_MISSING);
    });
    await expect(transport.connect()).rejects.toThrow(/not available in this build/);
    expect(transport.status).toBe('error');
  });

  it('a device-disconnected event for this address emits disconnected once; others are ignored', async () => {
    const { device, mod, transport, statuses, received } = setup();
    await transport.connect();
    mod.emitDisconnected('AA:BB:CC:DD:EE:FF');
    expect(transport.status).toBe('connected');

    mod.emitDisconnected(ADDR.toLowerCase());
    mod.emitDisconnected(ADDR);
    expect(transport.status).toBe('disconnected');
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    // The dead device's later data and the subscriptions are gone.
    device.emitData('41 0C 0C D0\r\r');
    expect(received).toEqual([]);
    expect(device.listenerCount).toBe(0);
    expect(mod.disconnectListenerCount).toBe(0);
  });

  it('the per-device socket-closed event (ACL link still up) is a drop too', async () => {
    const { device, mod, transport, statuses, received } = setup();
    await transport.connect();
    mod.emitSocketClosed('AA:BB:CC:DD:EE:FF');
    expect(transport.status).toBe('connected');

    mod.emitSocketClosed(ADDR);
    expect(transport.status).toBe('disconnected');
    expect(device.disconnects).toBe(1);
    // The ACL drop that may follow is ignored; the subscriptions are gone.
    mod.emitDisconnected(ADDR);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    device.emitData('41 0C 0C D0\r\r');
    expect(received).toEqual([]);
    expect(mod.disconnectListenerCount).toBe(0);
  });

  it('a manual disconnect closes the device and emits only disconnected', async () => {
    const { device, mod, transport, statuses } = setup();
    await transport.connect();
    await transport.disconnect();
    expect(device.disconnects).toBe(1);
    expect(transport.status).toBe('disconnected');
    // The library's own events for that close are no longer heard.
    mod.emitDisconnected(ADDR);
    mod.emitSocketClosed(ADDR);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    expect(statuses).not.toContain('error');
  });

  it('a disconnect during connect cancels it and closes the late device', async () => {
    let resolveDevice: (d: SppDeviceLike) => void = () => undefined;
    const late = new FakeSppDevice();
    const { transport, statuses } = setup(
      () => new Promise<SppDeviceLike>((r) => (resolveDevice = r)),
    );
    const pending = transport.connect();
    await new Promise((r) => setTimeout(r, 0));
    await transport.disconnect();
    resolveDevice(late);
    await expect(pending).rejects.toBeInstanceOf(SppConnectCancelledError);
    expect(transport.status).toBe('disconnected');
    expect(statuses).toEqual(['connecting', 'disconnected']);
    await new Promise((r) => setTimeout(r, 0));
    expect(late.disconnects).toBe(1);
  });

  it('reconnects with a fresh device after a drop', async () => {
    const devices = [new FakeSppDevice(), new FakeSppDevice()];
    let n = 0;
    const { mod, transport, received } = setup(() => devices[n++]);
    await transport.connect();
    mod.emitDisconnected(ADDR);
    await transport.connect();
    expect(transport.status).toBe('connected');
    devices[0].emitData('OLD');
    devices[1].emitData('NEW');
    expect(received).toEqual(['NEW>']);
  });

  it('declares that monitor mode cannot stream over this link', () => {
    const transport = new SppTransport(ADDR, async () => new FakeSppModule());
    expect(transport.capabilities.monitor).toBe(false);
    expect(canStreamMonitor(transport)).toBe(false);
  });
});

describe('listBondedAdapters', () => {
  it('lists paired devices, likely adapters first', async () => {
    const mod = new FakeSppModule();
    mod.bonded = [
      { address: '11:11:11:11:11:11', name: 'Car stereo' },
      { address: ADDR, name: 'OBDII' },
      { address: '22:22:22:22:22:22', name: null },
    ];
    const list = await listBondedAdapters(async () => mod);
    expect(list[0]).toEqual({ id: ADDR, name: 'OBDII', rssi: null, isLikelyAdapter: true });
    expect(list.filter((d) => d.isLikelyAdapter)).toHaveLength(1);
    expect(list.map((d) => d.id)).toContain('22:22:22:22:22:22');
  });

  it('refuses with a plain-English message while Bluetooth is off', async () => {
    const mod = new FakeSppModule();
    mod.enabled = false;
    await expect(listBondedAdapters(async () => mod)).rejects.toThrow(/Bluetooth is off/);
  });
});

describe('defaultSppModule', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native-bluetooth-classic');
  });

  it('throws a plain-English error when the Classic Bluetooth module is absent', async () => {
    jest.doMock('react-native-bluetooth-classic', () => ({}), { virtual: true });
    await expect(defaultSppModule()).rejects.toThrow(SPP_MODULE_MISSING);
  });

  it('returns the library instance (its default export)', async () => {
    const lib = new FakeSppModule();
    jest.doMock('react-native-bluetooth-classic', () => ({ __esModule: true, default: lib }), {
      virtual: true,
    });
    await expect(defaultSppModule()).resolves.toBe(lib);
  });
});
