/** Test-only fakes for `WebBluetoothTransport` (plan 28): a scriptable GATT tree (device → server →
 *  services → characteristics), a fake `navigator.bluetooth`, and a device that plays a BLE ELM327
 *  by forwarding to the simulator through the shared test bridge (`bridgeToMock`, plan 26). Never
 *  imported by app code. */

import type {
  WebBluetoothLike,
  WebBtCharacteristic,
  WebBtDevice,
  WebBtRequestOptions,
  WebBtServer,
  WebBtService,
  WebBtValueEvent,
} from '../WebBluetoothTransport';
import type { MockBridge } from '../../../obd-core/transport/testing/bridge';

type Props = WebBtCharacteristic['properties'];

const NONE: Props = { notify: false, indicate: false, write: false, writeWithoutResponse: false };

/** A characteristic whose notifications the test fires by hand (`emit`). Records every write and
 *  which write method carried it. */
export class FakeCharacteristic implements WebBtCharacteristic {
  readonly properties: Props;
  readonly writes: {
    method: 'withoutResponse' | 'withResponse' | 'writeValue';
    bytes: number[];
  }[] = [];
  notifying = false;
  private valueListeners = new Set<(ev: WebBtValueEvent) => void>();
  /** Reject the next write(s) with this error, when set. */
  failWrites: Error | null = null;
  writeValueWithoutResponse?: (data: Uint8Array) => Promise<void>;
  writeValueWithResponse?: (data: Uint8Array) => Promise<void>;

  constructor(
    readonly uuid: string,
    props: Partial<Props>,
    opts: { withoutResponseMethod?: boolean; withResponseMethod?: boolean } = {},
  ) {
    this.properties = { ...NONE, ...props };
    if (opts.withoutResponseMethod ?? true) {
      this.writeValueWithoutResponse = (d) => this.record('withoutResponse', d);
    }
    if (opts.withResponseMethod ?? false) {
      this.writeValueWithResponse = (d) => this.record('withResponse', d);
    }
  }

  protected record(method: FakeCharacteristic['writes'][number]['method'], data: Uint8Array) {
    if (this.failWrites) return Promise.reject(this.failWrites);
    this.writes.push({ method, bytes: [...data] });
    return Promise.resolve();
  }

  writeValue(data: Uint8Array): Promise<void> {
    return this.record('writeValue', data);
  }
  startNotifications(): Promise<unknown> {
    this.notifying = true;
    return Promise.resolve(this);
  }
  addEventListener(_type: 'characteristicvaluechanged', cb: (ev: WebBtValueEvent) => void): void {
    this.valueListeners.add(cb);
  }
  removeEventListener(
    _type: 'characteristicvaluechanged',
    cb: (ev: WebBtValueEvent) => void,
  ): void {
    this.valueListeners.delete(cb);
  }
  /** Fire one `characteristicvaluechanged` with `bytes` as the value. The `DataView` deliberately
   *  sits at an offset inside a larger buffer, as a browser's may. */
  emit(bytes: Uint8Array | number[]): void {
    const src = Uint8Array.from(bytes);
    const buffer = new ArrayBuffer(src.length + 4);
    new Uint8Array(buffer, 2, src.length).set(src);
    const ev: WebBtValueEvent = { target: { value: new DataView(buffer, 2, src.length) } };
    for (const cb of [...this.valueListeners]) cb(ev);
  }
  get listenerCount(): number {
    return this.valueListeners.size;
  }
}

export class FakeService implements WebBtService {
  constructor(
    readonly uuid: string,
    readonly characteristics: FakeCharacteristic[],
  ) {}
  getCharacteristics(): Promise<WebBtCharacteristic[]> {
    return Promise.resolve(this.characteristics);
  }
}

export class FakeServer implements WebBtServer {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  /** Reject `connect()` with this error, when set. */
  failConnect: Error | null = null;

  constructor(
    readonly device: FakeWebBtDevice,
    public services: FakeService[],
  ) {}

  connect(): Promise<WebBtServer> {
    this.connectCalls++;
    if (this.failConnect) return Promise.reject(this.failConnect);
    this.connected = true;
    return Promise.resolve(this);
  }
  disconnect(): void {
    this.disconnectCalls++;
    if (!this.connected) return;
    this.connected = false;
    // Like Chrome: a manual disconnect also fires the event (the transport must ignore it).
    this.device.fireDisconnected();
  }
  getPrimaryServices(): Promise<WebBtService[]> {
    return Promise.resolve(this.services);
  }
}

export class FakeWebBtDevice implements WebBtDevice {
  readonly gatt: FakeServer;
  private disconnectListeners = new Set<() => void>();

  constructor(
    readonly id: string,
    readonly name: string | null,
    services: FakeService[] = [],
  ) {
    this.gatt = new FakeServer(this, services);
  }

  addEventListener(_type: 'gattserverdisconnected', cb: () => void): void {
    this.disconnectListeners.add(cb);
  }
  removeEventListener(_type: 'gattserverdisconnected', cb: () => void): void {
    this.disconnectListeners.delete(cb);
  }
  fireDisconnected(): void {
    for (const cb of [...this.disconnectListeners]) cb();
  }
  /** The adapter went away on its own (unplugged, out of range). */
  dropLink(): void {
    this.gatt.connected = false;
    this.fireDisconnected();
  }
  get disconnectListenerCount(): number {
    return this.disconnectListeners.size;
  }
}

/** A fake `navigator.bluetooth`: resolves the chooser with `device`, or rejects with `error`
 *  (e.g. a `NotFoundError` for a cancelled chooser). Records the request options. */
export class FakeWebBluetooth implements WebBluetoothLike {
  readonly requests: WebBtRequestOptions[] = [];
  constructor(
    public device: WebBtDevice | null,
    public error: Error | null = null,
  ) {}
  requestDevice(opts: WebBtRequestOptions): Promise<WebBtDevice> {
    this.requests.push(opts);
    if (this.error) return Promise.reject(this.error);
    if (!this.device) return Promise.reject(namedError('NotFoundError', 'No device'));
    return Promise.resolve(this.device);
  }
}

/** An `Error` with a DOMException-style `name`, as Chrome rejects. */
export function namedError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

/** The FFF0 layout most ELM327 BLE clones use: FFF1 notify + FFF2 write-without-response. */
export const FFF0 = '0000fff0-0000-1000-8000-00805f9b34fb';
export const FFF1 = '0000fff1-0000-1000-8000-00805f9b34fb';
export const FFF2 = '0000fff2-0000-1000-8000-00805f9b34fb';

/** A BLE ELM327 whose GATT plays the simulator from `bridge`: every write to FFF2 goes to the
 *  virtual adapter, and every reply comes back as FFF1 notifications cut into 20-byte `DataView`s
 *  (the default-MTU payload a real adapter notifies in). A generic-access service without
 *  serial characteristics comes first, so the transport has to skip it. */
export function webDeviceOverBridge(bridge: MockBridge, id = 'web-ble-golf'): FakeWebBtDevice {
  const notify = new FakeCharacteristic(FFF1, { notify: true });
  const write = new FakeCharacteristic(FFF2, { write: true, writeWithoutResponse: true });
  const forward = (method: 'withoutResponse' | 'writeValue') => (data: Uint8Array) => {
    write.writes.push({ method, bytes: [...data] });
    bridge.write(data);
    return Promise.resolve();
  };
  write.writeValueWithoutResponse = forward('withoutResponse');
  write.writeValue = forward('writeValue');
  bridge.onData((bytes) => {
    for (let i = 0; i < bytes.length; i += 20) notify.emit(bytes.subarray(i, i + 20));
  });
  const genericAccess = new FakeService('00001800-0000-1000-8000-00805f9b34fb', [
    new FakeCharacteristic('00002a00-0000-1000-8000-00805f9b34fb', {}),
  ]);
  return new FakeWebBtDevice(id, 'IOS-Vlink', [
    genericAccess,
    new FakeService(FFF0, [notify, write]),
  ]);
}
