// BleTransport reads `Platform.OS` to decide whether to request an MTU; the test runs in node, so
// react-native is replaced by a mutable stub (flipped to 'ios' in the iOS case below).
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }), { virtual: true });

import { BleTransport, payloadForMtu } from './BleTransport';
import { base64ToBytes, bytesToBase64 } from '../../lib/base64';
import { bytesToString, stringToBytes } from '../../lib/bytes';
import { Elm327Client } from '../../obd-core/elm327/Elm327Client';
import { MockTransport } from '../../obd-core/transport/MockTransport';
import { buildScenario } from '../../obd-core/transport/scenarios';
import { getVehicleProfile } from '../../vehicles';

const rn = jest.requireMock<{ Platform: { OS: string } }>('react-native');

/** Minimal fakes for react-native-ble-plx (a type-only import in BleTransport). Only the surface
 *  BleTransport actually calls is implemented. */

function makeChar(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'char',
    isNotifiable: false,
    isIndicatable: false,
    isWritableWithoutResponse: false,
    isWritableWithResponse: false,
    ...overrides,
  };
}

type MonitorCb = (error: unknown, characteristic: { value: string | null } | null) => void;

interface DeviceOpts {
  discover?: () => Promise<void>;
  services?: () => Promise<unknown[]>;
  mtu?: number;
  /** Called with each decoded GATT write payload. */
  onWrite?: (bytes: number[]) => void;
}

function makeDevice(opts: DeviceOpts = {}) {
  const monitorRemove = jest.fn();
  const disconnectRemove = jest.fn();
  let monitorCb: MonitorCb | null = null;
  const record = async (_s: string, _c: string, value: string) => {
    opts.onWrite?.(base64ToBytes(value));
    return undefined;
  };
  const device = {
    mtu: opts.mtu,
    monitorRemove,
    disconnectRemove,
    discoverAllServicesAndCharacteristics: opts.discover ?? (async () => undefined),
    services: opts.services ?? (async () => []),
    monitorCharacteristicForService: jest.fn((_s: string, _c: string, cb: MonitorCb) => {
      monitorCb = cb;
      return { remove: monitorRemove };
    }),
    onDisconnected: jest.fn(() => ({ remove: disconnectRemove })),
    cancelConnection: jest.fn(async () => undefined),
    writeCharacteristicWithoutResponseForService: jest.fn(record),
    writeCharacteristicWithResponseForService: jest.fn(record),
    /** Push a notification into the transport, as the adapter would. */
    notify: (b64: string) => monitorCb?.(null, { value: b64 }),
  };
  return device;
}

function makeManager(device: ReturnType<typeof makeDevice>) {
  return {
    connectToDevice: jest.fn(async (_id: string, _opts?: object) => device),
    cancelDeviceConnection: jest.fn(async () => device),
  };
}

const usableService = {
  uuid: 'svc',
  characteristics: async () => [
    makeChar({ uuid: 'n', isNotifiable: true }),
    makeChar({ uuid: 'w', isWritableWithoutResponse: true }),
  ],
};

describe('BleTransport', () => {
  it('cancels the OS GATT connection when discovery fails (no leak)', async () => {
    const device = makeDevice({
      discover: async () => {
        throw new Error('discover failed');
      },
    });
    const manager = makeManager(device);
    const t = new BleTransport(manager as never, 'dev-1');

    await expect(t.connect()).rejects.toThrow('discover failed');
    expect(t.status).toBe('error');
    expect(manager.cancelDeviceConnection).toHaveBeenCalledWith('dev-1');
  });

  it('cancels the connection when no notify+write characteristic exists', async () => {
    const device = makeDevice({
      services: async () => [{ uuid: 'svc', characteristics: async () => [makeChar()] }],
    });
    const manager = makeManager(device);
    const t = new BleTransport(manager as never, 'dev-2');

    await expect(t.connect()).rejects.toThrow(/notify/i);
    expect(manager.cancelDeviceConnection).toHaveBeenCalledWith('dev-2');
  });

  it('tears down a connection that completes after a concurrent disconnect (no leak)', async () => {
    let reached!: () => void;
    const reachedServices = new Promise<void>((r) => {
      reached = r;
    });
    let releaseServices!: () => void;
    const gate = new Promise<void>((r) => {
      releaseServices = r;
    });
    const device = makeDevice({
      services: async () => {
        reached(); // by now this.device is set inside BleTransport
        await gate; // park connect() here so disconnect() can land mid-connect
        return [usableService];
      },
    });
    const manager = makeManager(device);
    const t = new BleTransport(manager as never, 'dev-3');

    const connecting = t.connect();
    await reachedServices;
    await t.disconnect(); // superseding disconnect while connect() is parked
    releaseServices();
    await connecting;

    expect(t.status).toBe('disconnected');
    expect(device.cancelConnection).toHaveBeenCalled(); // the live GATT link was cancelled
    expect(device.monitorRemove).toHaveBeenCalled(); // the monitor connect() wired up was removed
  });

  describe('MTU + chunked writes', () => {
    afterEach(() => {
      rn.Platform.OS = 'android';
    });

    /** A 16-byte UDS 2E coding write as the ELM client sends it: 2E + DID + 32 hex + CR = 39 B. */
    const codingWrite = stringToBytes('2E0600' + '00112233445566778899AABBCCDDEEFF' + '\r');

    it('splits a 39-byte write into 20 + 19 byte GATT writes at the default MTU 23', async () => {
      const sizes: number[] = [];
      const device = makeDevice({
        services: async () => [usableService],
        mtu: 23,
        onWrite: (b) => sizes.push(b.length),
      });
      const t = new BleTransport(makeManager(device) as never, 'dev-4');
      await t.connect();
      expect(codingWrite.length).toBe(39);
      await t.write(codingWrite);
      expect(device.writeCharacteristicWithoutResponseForService).toHaveBeenCalledTimes(2);
      expect(sizes).toEqual([20, 19]);
    });

    it('sends one GATT write when the negotiated MTU is 247', async () => {
      const sizes: number[] = [];
      const device = makeDevice({
        services: async () => [usableService],
        mtu: 247,
        onWrite: (b) => sizes.push(b.length),
      });
      const t = new BleTransport(makeManager(device) as never, 'dev-5');
      await t.connect();
      await t.write(codingWrite);
      expect(device.writeCharacteristicWithoutResponseForService).toHaveBeenCalledTimes(1);
      expect(sizes).toEqual([39]);
    });

    it('uses with-response writes, in order, when that is all the adapter offers', async () => {
      const chunks: string[] = [];
      const device = makeDevice({
        services: async () => [
          {
            uuid: 'svc',
            characteristics: async () => [
              makeChar({ uuid: 'n', isIndicatable: true }),
              makeChar({ uuid: 'w', isWritableWithResponse: true }),
            ],
          },
        ],
        onWrite: (b) => chunks.push(String.fromCharCode(...b)),
      });
      const t = new BleTransport(makeManager(device) as never, 'dev-6');
      await t.connect();
      await t.write(codingWrite);
      expect(device.writeCharacteristicWithResponseForService).toHaveBeenCalledTimes(2);
      expect(device.writeCharacteristicWithoutResponseForService).not.toHaveBeenCalled();
      expect(chunks.join('')).toBe(bytesToString(codingWrite));
    });

    it('terminates a half-sent command with a line flush when a later chunk fails', async () => {
      const chunks: string[] = [];
      let calls = 0;
      const device = makeDevice({
        services: async () => [usableService],
        mtu: 23,
        onWrite: (b) => {
          calls++;
          if (calls === 2) throw new Error('GATT busy'); // the second chunk of the 2E write fails
          chunks.push(String.fromCharCode(...b));
        },
      });
      const t = new BleTransport(makeManager(device) as never, 'dev-8');
      await t.connect();
      await expect(t.write(codingWrite)).rejects.toThrow('GATT busy');
      // First chunk, then the flush — never the bare `\r` that would run the truncated `2E`.
      expect(chunks).toEqual([bytesToString(codingWrite).slice(0, 20), 'X\r']);
      expect(chunks.join('')).not.toMatch(/^2E[0-9A-F]*\r/);
    });

    it('sends no flush when the very first chunk fails (nothing was buffered)', async () => {
      const device = makeDevice({
        services: async () => [usableService],
        mtu: 23,
        onWrite: () => {
          throw new Error('GATT busy');
        },
      });
      const t = new BleTransport(makeManager(device) as never, 'dev-9');
      await t.connect();
      await expect(t.write(codingWrite)).rejects.toThrow('GATT busy');
      expect(device.writeCharacteristicWithoutResponseForService).toHaveBeenCalledTimes(1);
    });

    it('populates linkInfo after connect and clears it on disconnect', async () => {
      const device = makeDevice({ services: async () => [usableService], mtu: 185 });
      const t = new BleTransport(makeManager(device) as never, 'dev-7');
      expect(t.linkInfo).toBeNull();
      await t.connect();
      expect(t.linkInfo).toEqual({
        mtu: 185,
        payload: 182,
        service: 'svc',
        notifyCharacteristic: 'n',
        writeCharacteristic: 'w',
        writeWithoutResponse: true,
      });
      await t.disconnect();
      expect(t.linkInfo).toBeNull();
    });

    it('falls back to MTU 23 (payload 20) when the stack reports none', async () => {
      const device = makeDevice({ services: async () => [usableService] });
      const t = new BleTransport(makeManager(device) as never, 'dev-8');
      await t.connect();
      expect(t.linkInfo?.mtu).toBe(23);
      expect(t.linkInfo?.payload).toBe(20);
      expect(payloadForMtu(10)).toBe(20);
    });

    it('requests MTU 247 on Android and passes no requestMTU on iOS', async () => {
      const android = makeDevice({ services: async () => [usableService] });
      const am = makeManager(android);
      await new BleTransport(am as never, 'dev-9').connect();
      expect(am.connectToDevice).toHaveBeenCalledWith('dev-9', { requestMTU: 247 });

      rn.Platform.OS = 'ios';
      const ios = makeDevice({ services: async () => [usableService] });
      const im = makeManager(ios);
      await new BleTransport(im as never, 'dev-10').connect();
      const opts = im.connectToDevice.mock.calls[0][1];
      expect(opts).toEqual({});
      expect(opts).not.toHaveProperty('requestMTU');
    });

    it('a 16-byte coding write to the simulated Golf succeeds through an MTU-23 link', async () => {
      // The fake adapter reassembles its UART input until the CR (like a real ELM327) and hands
      // each full command to the Golf simulator; the simulator's replies come back as notifications.
      const bcm = getVehicleProfile('golf-plus-2009-20tdi').codingModules![0];
      const sim = new MockTransport(buildScenario('golf-plus-2009-20tdi'));
      await sim.connect();
      let line = '';
      const sizes: number[] = [];
      const device = makeDevice({
        services: async () => [usableService],
        mtu: 23,
        onWrite: (b) => {
          sizes.push(b.length);
          line += String.fromCharCode(...b);
          let cr: number;
          while ((cr = line.indexOf('\r')) >= 0) {
            const cmd = line.slice(0, cr + 1);
            line = line.slice(cr + 1);
            void sim.write(stringToBytes(cmd));
          }
        },
      });
      sim.onData((bytes) => device.notify(bytesToBase64(bytes)));

      const t = new BleTransport(makeManager(device) as never, 'dev-golf');
      await t.connect();
      const client = new Elm327Client(t, {
        commandTimeoutMs: 1000,
        firstCommandTimeoutMs: 1000,
        wakeAfterIdleMs: 0,
      });
      client.attach();
      await client.init();
      const data = '00112233445566778899AABBCCDDEEFF';
      expect(await client.raw(`ATSH${bcm.reqHeader}`)).toContain('OK');
      const reply = await client.command(`2E${bcm.codingDid}${data}`);
      expect(reply.bytes.slice(0, 3)).toEqual([
        0x6e,
        parseInt(bcm.codingDid.slice(0, 2), 16),
        parseInt(bcm.codingDid.slice(2, 4), 16),
      ]);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
      expect(sizes).toContain(20); // the 39-byte write really was chunked
      const read = await client.command(`22${bcm.codingDid}`);
      expect(read.bytes.slice(3)).toEqual(Array.from({ length: 16 }, (_, i) => i * 0x11));
    });
  });
});
