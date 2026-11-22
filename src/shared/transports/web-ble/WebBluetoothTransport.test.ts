/** WebBluetoothTransport (plan 28) against a fake GATT tree: characteristic discovery, notification
 *  bytes, 20-byte chunked writes, link loss, and the failure paths. */
import {
  WebBluetoothTransport,
  NO_SERIAL_CHARACTERISTICS,
  WEB_BLUETOOTH_UNSUPPORTED,
  describeWebBluetoothError,
  getWebBluetooth,
  isWebBluetoothAvailable,
} from './WebBluetoothTransport';
import {
  FFF0,
  FFF1,
  FFF2,
  FakeCharacteristic,
  FakeService,
  FakeWebBluetooth,
  FakeWebBtDevice,
  namedError,
} from './testing/fakeWebBluetooth';
import { OBD_SERVICE_UUIDS } from '../common/obdServiceUuids';
import { OBD_SERVICE_UUIDS as BLE_SERVICE_UUIDS } from '../ble/manager';
import type { TransportStatus } from '../../obd-core/transport/Transport';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn() }));

const FFE0 = '0000ffe0-0000-1000-8000-00805f9b34fb';
const FFE1 = '0000ffe1-0000-1000-8000-00805f9b34fb';

function serialDevice(
  writeProps: Partial<FakeCharacteristic['properties']> = { writeWithoutResponse: true },
  opts?: ConstructorParameters<typeof FakeCharacteristic>[2],
) {
  const notify = new FakeCharacteristic(FFF1, { notify: true });
  const write = new FakeCharacteristic(FFF2, writeProps, opts);
  const device = new FakeWebBtDevice('dev-1', 'OBDII', [new FakeService(FFF0, [notify, write])]);
  return { device, notify, write };
}

function trackStatus(t: WebBluetoothTransport): TransportStatus[] {
  const seen: TransportStatus[] = [];
  t.onStatusChange((s) => seen.push(s));
  return seen;
}

describe('WebBluetoothTransport.pickDevice', () => {
  it('opens the chooser for every device with the OBD2 services allowed', async () => {
    const { device } = serialDevice();
    const bt = new FakeWebBluetooth(device);
    await expect(WebBluetoothTransport.pickDevice(bt)).resolves.toBe(device);
    expect(bt.requests).toEqual([{ acceptAllDevices: true, optionalServices: OBD_SERVICE_UUIDS }]);
  });

  it('passes a cancelled chooser through as the browser error', async () => {
    const bt = new FakeWebBluetooth(
      null,
      namedError('NotFoundError', 'User cancelled the requestDevice() chooser.'),
    );
    await expect(WebBluetoothTransport.pickDevice(bt)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('rejects with the unsupported-browser message when there is no Web Bluetooth', async () => {
    await expect(WebBluetoothTransport.pickDevice(null)).rejects.toThrow(WEB_BLUETOOTH_UNSUPPORTED);
  });
});

describe('WebBluetoothTransport', () => {
  it('picks the first service with notify + write, starts notifications, reports the link', async () => {
    const decoyNotify = new FakeCharacteristic(FFE1, { notify: true });
    const { notify, write } = serialDevice();
    const device = new FakeWebBtDevice('dev-1', 'OBDII', [
      // Notify only — not usable on its own.
      new FakeService(FFE0, [decoyNotify]),
      new FakeService(FFF0, [notify, write]),
    ]);
    const t = new WebBluetoothTransport(device);
    const seen = trackStatus(t);
    await t.connect();
    expect(seen).toEqual(['connecting', 'connected']);
    expect(notify.notifying).toBe(true);
    expect(decoyNotify.notifying).toBe(false);
    expect(t.linkInfo).toEqual({
      mtu: 23,
      payload: 20,
      service: FFF0,
      notifyCharacteristic: FFF1,
      writeCharacteristic: FFF2,
      writeWithoutResponse: true,
    });
  });

  it('emits the bytes of each notification DataView', async () => {
    const { device, notify } = serialDevice();
    const t = new WebBluetoothTransport(device);
    const got: number[][] = [];
    t.onData((b) => got.push([...b]));
    await t.connect();
    notify.emit([0x34, 0x31, 0x0d]);
    notify.emit([0x3e]);
    expect(got).toEqual([[0x34, 0x31, 0x0d], [0x3e]]);
  });

  it('chunks a 39-byte write into 20 + 19 without-response writes, in order', async () => {
    const { device, write } = serialDevice();
    const t = new WebBluetoothTransport(device);
    await t.connect();
    const bytes = Uint8Array.from({ length: 39 }, (_, i) => i);
    await t.write(bytes);
    expect(write.writes.map((w) => w.method)).toEqual(['withoutResponse', 'withoutResponse']);
    expect(write.writes.map((w) => w.bytes.length)).toEqual([20, 19]);
    expect(write.writes.flatMap((w) => w.bytes)).toEqual([...bytes]);
  });

  it('falls back to writeValue when writeValueWithoutResponse is absent', async () => {
    const { device, write } = serialDevice(
      { writeWithoutResponse: true },
      { withoutResponseMethod: false },
    );
    const t = new WebBluetoothTransport(device);
    await t.connect();
    await t.write(Uint8Array.from({ length: 25 }, () => 0x41));
    expect(write.writes.map((w) => [w.method, w.bytes.length])).toEqual([
      ['writeValue', 20],
      ['writeValue', 5],
    ]);
  });

  it('uses writeValueWithResponse for a with-response-only characteristic', async () => {
    const { device, write } = serialDevice({ write: true }, { withResponseMethod: true });
    const t = new WebBluetoothTransport(device);
    await t.connect();
    expect(t.linkInfo?.writeWithoutResponse).toBe(false);
    await t.write(Uint8Array.from([0x30, 0x31, 0x30, 0x30, 0x0d]));
    expect(write.writes.map((w) => w.method)).toEqual(['withResponse']);
  });

  it('flushes the adapter line when a chunk fails partway', async () => {
    const { device, write } = serialDevice();
    const t = new WebBluetoothTransport(device);
    await t.connect();
    let n = 0;
    write.writeValueWithoutResponse = (d) => {
      n++;
      if (n === 2) return Promise.reject(new Error('GATT operation failed'));
      write.writes.push({ method: 'withoutResponse', bytes: [...d] });
      return Promise.resolve();
    };
    await expect(t.write(new Uint8Array(30))).rejects.toThrow('GATT operation failed');
    expect(write.writes.map((w) => w.bytes)).toEqual([[...new Uint8Array(20)], [0x58, 0x0d]]);
  });

  it('serialises separate write() calls: one GATT operation at a time', async () => {
    const { device, write } = serialDevice({ write: true }, { withResponseMethod: true });
    const t = new WebBluetoothTransport(device);
    await t.connect();
    // A with-response write that stalls until released; a second operation while one is pending
    // would be Chrome's "GATT operation already in progress".
    const releases: (() => void)[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    write.writeValueWithResponse = (d) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      write.writes.push({ method: 'withResponse', bytes: [...d] });
      return new Promise<void>((r) =>
        releases.push(() => {
          inFlight--;
          r();
        }),
      );
    };
    const first = t.write(Uint8Array.from([0x41, 0x0d])); // e.g. a wake write that timed out
    const second = t.write(Uint8Array.from([0x42, 0x0d])); // the next command, not awaited first
    await Promise.resolve();
    await Promise.resolve();
    expect(write.writes.map((w) => w.bytes)).toEqual([[0x41, 0x0d]]);
    releases.shift()!();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(write.writes.map((w) => w.bytes)).toEqual([
      [0x41, 0x0d],
      [0x42, 0x0d],
    ]);
    releases.shift()!();
    await second;
    expect(maxInFlight).toBe(1);
  });

  it('a failed write does not block the queued one behind it', async () => {
    const { device, write } = serialDevice();
    const t = new WebBluetoothTransport(device);
    await t.connect();
    let failNext = true;
    write.writeValueWithoutResponse = (d) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error('GATT operation failed'));
      }
      write.writes.push({ method: 'withoutResponse', bytes: [...d] });
      return Promise.resolve();
    };
    const first = t.write(Uint8Array.from([0x41, 0x0d]));
    const second = t.write(Uint8Array.from([0x42, 0x0d]));
    await expect(first).rejects.toThrow('GATT operation failed');
    await expect(second).resolves.toBeUndefined();
    expect(write.writes.map((w) => w.bytes)).toEqual([[0x42, 0x0d]]);
  });

  it('refuses to write before connecting', async () => {
    const { device } = serialDevice();
    await expect(new WebBluetoothTransport(device).write(Uint8Array.from([1]))).rejects.toThrow(
      /not connected/,
    );
  });

  it('reports gattserverdisconnected as disconnected exactly once', async () => {
    const { device, notify } = serialDevice();
    const t = new WebBluetoothTransport(device);
    const seen = trackStatus(t);
    await t.connect();
    device.dropLink();
    device.dropLink();
    expect(seen).toEqual(['connecting', 'connected', 'disconnected']);
    expect(t.linkInfo).toBeNull();
    expect(device.disconnectListenerCount).toBe(0);
    expect(notify.listenerCount).toBe(0);
  });

  it('a manual disconnect closes GATT without reporting a link loss twice', async () => {
    const { device, notify } = serialDevice();
    const t = new WebBluetoothTransport(device);
    const seen = trackStatus(t);
    await t.connect();
    await t.disconnect();
    expect(device.gatt.disconnectCalls).toBe(1);
    expect(device.gatt.connected).toBe(false);
    expect(seen).toEqual(['connecting', 'connected', 'disconnected']);
    expect(notify.listenerCount).toBe(0);
  });

  it('reconnects through the same picked device (no new chooser)', async () => {
    const { device } = serialDevice();
    const t = new WebBluetoothTransport(device);
    await t.connect();
    device.dropLink();
    await t.connect();
    expect(t.status).toBe('connected');
    expect(device.gatt.connectCalls).toBe(2);
  });

  it('rejects and closes GATT when no service has notify + write', async () => {
    const device = new FakeWebBtDevice('dev-2', 'Headset', [
      new FakeService(FFE0, [new FakeCharacteristic(FFE1, { notify: true })]),
    ]);
    const t = new WebBluetoothTransport(device);
    const seen = trackStatus(t);
    await expect(t.connect()).rejects.toThrow(NO_SERIAL_CHARACTERISTICS);
    expect(device.gatt.disconnectCalls).toBe(1);
    expect(device.gatt.connected).toBe(false);
    expect(seen).toEqual(['connecting', 'error']);
  });

  it('a failed GATT connect ends in error with the browser error', async () => {
    const { device } = serialDevice();
    device.gatt.failConnect = namedError('NetworkError', 'Bluetooth Device is no longer in range.');
    const t = new WebBluetoothTransport(device);
    await expect(t.connect()).rejects.toMatchObject({ name: 'NetworkError' });
    expect(t.status).toBe('error');
  });

  it('a disconnect during connect tears the half-built link down', async () => {
    const { device, notify } = serialDevice();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const getServices = device.gatt.getPrimaryServices.bind(device.gatt);
    device.gatt.getPrimaryServices = async () => {
      await gate;
      return getServices();
    };
    const t = new WebBluetoothTransport(device);
    const connecting = t.connect();
    await t.disconnect();
    release();
    await connecting;
    expect(t.status).toBe('disconnected');
    expect(device.gatt.connected).toBe(false);
    expect(notify.listenerCount).toBe(0);
    expect(device.disconnectListenerCount).toBe(0);
  });
});

describe('Web Bluetooth helpers', () => {
  const g = globalThis as { navigator?: unknown };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete g.navigator;
  });

  it('detects navigator.bluetooth', () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    expect(isWebBluetoothAvailable()).toBe(false);
    const bt = new FakeWebBluetooth(null);
    Object.defineProperty(globalThis, 'navigator', {
      value: { bluetooth: bt },
      configurable: true,
    });
    expect(isWebBluetoothAvailable()).toBe(true);
    expect(getWebBluetooth()).toBe(bt);
  });

  it('turns browser errors into plain English', () => {
    expect(
      describeWebBluetoothError(
        namedError('NotFoundError', 'User cancelled the requestDevice() chooser.'),
      ),
    ).toMatch(/^No adapter was chosen/);
    expect(
      describeWebBluetoothError(namedError('NotFoundError', 'No Services found in device.')),
    ).toMatch(/does not offer an OBD2 adapter service/);
    expect(
      describeWebBluetoothError(namedError('SecurityError', 'Must be handling a user gesture')),
    ).toMatch(/HTTPS/);
    expect(describeWebBluetoothError(namedError('NotAllowedError', 'Globally disabled.'))).toMatch(
      /blocked for this site/,
    );
    expect(describeWebBluetoothError(namedError('NetworkError', 'Connection failed'))).toMatch(
      /Could not open the Bluetooth link/,
    );
    expect(describeWebBluetoothError(new Error('other'))).toBe('other');
  });

  it('the native scan re-exports the same service list', () => {
    expect(BLE_SERVICE_UUIDS).toBe(OBD_SERVICE_UUIDS);
  });

  it('lists full lowercase 128-bit UUIDs, including the Vgate vendor service', () => {
    // Web Bluetooth rejects short or upper-case strings, and hides every service not listed.
    for (const uuid of OBD_SERVICE_UUIDS) {
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(OBD_SERVICE_UUIDS).toContain('e7810a71-73ae-499d-8c15-faa9aef0c3f2');
  });
});
