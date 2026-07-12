import { BleTransport } from './BleTransport';

/** Minimal fakes for react-native-ble-plx (a type-only import in BleTransport, so there is no RN
 *  runtime to mock here). Only the surface BleTransport actually calls is implemented. */

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

interface DeviceOpts {
  discover?: () => Promise<void>;
  services?: () => Promise<unknown[]>;
}

function makeDevice(opts: DeviceOpts = {}) {
  const monitorRemove = jest.fn();
  const disconnectRemove = jest.fn();
  const device = {
    monitorRemove,
    disconnectRemove,
    discoverAllServicesAndCharacteristics: opts.discover ?? (async () => undefined),
    services: opts.services ?? (async () => []),
    monitorCharacteristicForService: jest.fn(() => ({ remove: monitorRemove })),
    onDisconnected: jest.fn(() => ({ remove: disconnectRemove })),
    cancelConnection: jest.fn(async () => undefined),
  };
  return device;
}

function makeManager(device: ReturnType<typeof makeDevice>) {
  return {
    connectToDevice: jest.fn(async () => device),
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
});
