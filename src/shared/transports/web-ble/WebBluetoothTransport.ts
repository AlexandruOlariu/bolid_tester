/** Transport over **Web Bluetooth** (plan 28): the browser build's way to reach a Bluetooth LE
 *  ELM327 (Chrome / Edge on desktop and Android, over HTTPS). It mirrors `BleTransport`: no
 *  hard-coded characteristic UUIDs — the first primary service exposing a notify (or indicate) and a
 *  write characteristic is used, so it works across ELM327 BLE clones.
 *
 *  Written against the narrow `WebBluetoothLike` / `WebBt*` interfaces below rather than the DOM
 *  typings, so Node tests inject a fake GATT (`testing/fakeWebBluetooth.ts`) and the core typecheck
 *  needs no DOM lib. Pure: no React Native, no `react-native-ble-plx`.
 *
 *  Browser rules this file depends on:
 *  - `navigator.bluetooth.requestDevice()` must run inside a user gesture (the Connect button's
 *    press handler) — `pickDevice` is therefore separate from `connect`, and a reconnect reuses the
 *    picked `WebBtDevice` (its `gatt.connect()` needs no gesture).
 *  - Only services listed in `optionalServices` can be opened; `OBD_SERVICE_UUIDS` names them.
 *  - There is no MTU API: writes go out in 20-byte chunks (the BLE 4.0 minimum payload).
 *  - One GATT operation per characteristic at a time: a second write while one is pending is
 *    rejected ("GATT operation already in progress"), where ble-plx on the phone queues it — so
 *    `write()` calls are serialised here (`writeChain`). */

import type { Transport, TransportStatus } from '../../obd-core/transport/Transport';
import { OBD_SERVICE_UUIDS } from '../common/obdServiceUuids';
import { DEFAULT_ATT_MTU, LINE_FLUSH, MIN_PAYLOAD, type BleLinkInfo } from '../common/gatt';

/** A characteristic value event: `target` is the characteristic, `value` its new bytes. */
export interface WebBtValueEvent {
  target: { value?: DataView | null } | null;
}

export interface WebBtCharacteristic {
  uuid: string;
  properties: { notify: boolean; indicate: boolean; write: boolean; writeWithoutResponse: boolean };
  startNotifications(): Promise<unknown>;
  stopNotifications?(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', cb: (ev: WebBtValueEvent) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', cb: (ev: WebBtValueEvent) => void): void;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
  writeValueWithResponse?(data: Uint8Array): Promise<void>;
  writeValue(data: Uint8Array): Promise<void>;
}

export interface WebBtService {
  uuid: string;
  getCharacteristics(): Promise<WebBtCharacteristic[]>;
}

export interface WebBtServer {
  connected: boolean;
  connect(): Promise<WebBtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<WebBtService[]>;
}

export interface WebBtDevice {
  id: string;
  name?: string | null;
  gatt?: WebBtServer;
  addEventListener(type: 'gattserverdisconnected', cb: () => void): void;
  removeEventListener(type: 'gattserverdisconnected', cb: () => void): void;
}

export interface WebBtRequestOptions {
  acceptAllDevices?: boolean;
  filters?: unknown[];
  optionalServices?: string[];
}

/** The slice of `navigator.bluetooth` this transport uses. */
export interface WebBluetoothLike {
  requestDevice(opts: WebBtRequestOptions): Promise<WebBtDevice>;
}

/** Shown when the browser has no Web Bluetooth (Safari, Firefox, iOS, an `http://` page). */
export const WEB_BLUETOOTH_UNSUPPORTED =
  'This browser cannot talk to Bluetooth adapters. Use Chrome or Edge on a computer or on Android, ' +
  'over HTTPS — Safari, Firefox and every iPhone browser do not support Web Bluetooth. The ' +
  'simulator still works here.';

/** Thrown by `connect()` when no primary service has both a notify and a write characteristic. */
export const NO_SERIAL_CHARACTERISTICS =
  'No suitable notify + write characteristics found on this device';

/** `navigator.bluetooth`, or null when the browser (or platform) has none. */
export function getWebBluetooth(): WebBluetoothLike | null {
  const nav = (globalThis as { navigator?: { bluetooth?: unknown } }).navigator;
  const bt = nav?.bluetooth as Partial<WebBluetoothLike> | undefined;
  return bt && typeof bt.requestDevice === 'function' ? (bt as WebBluetoothLike) : null;
}

/** True when this browser exposes Web Bluetooth (`navigator.bluetooth`). */
export const isWebBluetoothAvailable = (): boolean => getWebBluetooth() !== null;

/** A plain-English message for a Web Bluetooth failure. Chrome reports through `DOMException`
 *  names: `NotFoundError` (the chooser was cancelled, or no listed service exists on the device),
 *  `SecurityError` (no user gesture, or not HTTPS), `NotAllowedError` (Bluetooth blocked for the
 *  site), `NetworkError` (the GATT link could not be opened or dropped). */
export function describeWebBluetoothError(e: unknown): string {
  const name = (e as { name?: unknown } | null)?.name;
  const raw = e instanceof Error ? e.message : String(e);
  switch (name) {
    case 'NotFoundError':
      return /cancel/i.test(raw)
        ? 'No adapter was chosen. Tap “Choose adapter & connect” and pick your OBD2 adapter ' +
            '(often named OBDII, Vgate or IOS-Vlink) in the browser’s list.'
        : 'The chosen device does not offer an OBD2 adapter service. Pick the OBD2 adapter in the ' +
            `browser’s list, not a phone, watch or headset. (${raw})`;
    case 'SecurityError':
      return (
        'The browser refused Bluetooth access. Open the app over HTTPS and press the button ' +
        `directly (the device list only opens from a tap). (${raw})`
      );
    case 'NotAllowedError':
      return (
        'Bluetooth is blocked for this site. Allow Bluetooth in the browser’s site settings, ' +
        `make sure the computer's or phone’s Bluetooth is on, then try again. (${raw})`
      );
    case 'NetworkError':
      return (
        'Could not open the Bluetooth link to the adapter. Check it is powered (ignition on), ' +
        `close other apps using it, keep it close, and try again. (${raw})`
      );
    default:
      return raw;
  }
}

interface WriteTarget {
  service: string;
  notify: WebBtCharacteristic;
  write: WebBtCharacteristic;
  withoutResponse: boolean;
}

export class WebBluetoothTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private target: WriteTarget | null = null;
  private listeners = new Set<(b: Uint8Array) => void>();
  private statusListeners = new Set<(s: TransportStatus) => void>();
  /** Bumped by disconnect() (and each connect()) so an in-flight connect() can detect it was
   *  superseded and tear its half-built link back down instead of leaking it. */
  private connectSeq = 0;
  private disconnectWatched = false;
  /** Tail of the write queue: each `write()` starts only after the previous one settled (plan 28
   *  review). The ELM327 client fires command writes without awaiting them and moves on after a
   *  reply or a timeout, so a stalled write must not overlap the next one. Reset on teardown, so a
   *  write hung on a dead link never holds up the next connection. */
  private writeChain: Promise<void> = Promise.resolve();

  /** Open the browser's device chooser. **Must be called from a user gesture** (the Connect
   *  button's press handler): Chrome rejects `requestDevice` otherwise. Every device is listed
   *  (ELM327 clones advertise inconsistent names and services), and the OBD2 service UUIDs are
   *  requested so the transport may open them. Rejects with the browser's error — a cancelled
   *  chooser is a `NotFoundError` (see `describeWebBluetoothError`). */
  static pickDevice(bt: WebBluetoothLike | null = getWebBluetooth()): Promise<WebBtDevice> {
    if (!bt) return Promise.reject(new Error(WEB_BLUETOOTH_UNSUPPORTED));
    return bt.requestDevice({ acceptAllDevices: true, optionalServices: [...OBD_SERVICE_UUIDS] });
  }

  constructor(private readonly device: WebBtDevice) {}

  /** Move to a new link status, notifying subscribers only on an actual transition. */
  private setStatus(status: TransportStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of [...this.statusListeners]) l(status);
  }

  onStatusChange(listener: (s: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onData(listener: (bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Bytes from the notify characteristic. The `DataView` may be a window on a larger buffer, so
   *  only its own range is copied. */
  private readonly onValue = (ev: WebBtValueEvent): void => {
    const view = ev?.target?.value;
    if (!view || view.byteLength === 0) return;
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    for (const l of [...this.listeners]) l(bytes);
  };

  /** Unsolicited link loss (adapter unplugged, out of range, the browser dropped it): report it once
   *  so the session layer flips to disconnected instead of grinding through command timeouts. */
  private readonly onGattDisconnected = (): void => {
    this.detach();
    this.setStatus('disconnected');
  };

  async connect(): Promise<void> {
    const token = ++this.connectSeq;
    this.setStatus('connecting');
    const gatt = this.device.gatt;
    try {
      if (!gatt) throw new Error('This Bluetooth device has no GATT server');
      const server = await gatt.connect();
      await this.selectCharacteristics(server);
      if (token !== this.connectSeq) {
        // A disconnect() (or a newer connect()) landed while we were connecting.
        this.teardown();
        return;
      }
      this.device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
      this.disconnectWatched = true;
      this.setStatus('connected');
    } catch (e) {
      this.detach();
      // The GATT link may be open even though discovery failed; close it so it doesn't block the
      // next attempt.
      try {
        if (gatt?.connected) gatt.disconnect();
      } catch {
        // best-effort
      }
      this.setStatus('error');
      throw e;
    }
  }

  /** Pick the first primary service that exposes both a notify/indicate and a write characteristic,
   *  and start its notifications. */
  private async selectCharacteristics(server: WebBtServer): Promise<void> {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      const chars = await service.getCharacteristics();
      const notify = chars.find((c) => c.properties.notify || c.properties.indicate);
      const write = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
      if (!notify || !write) continue;
      notify.addEventListener('characteristicvaluechanged', this.onValue);
      this.target = {
        service: service.uuid,
        notify,
        write,
        withoutResponse: write.properties.writeWithoutResponse,
      };
      await notify.startNotifications();
      return;
    }
    throw new Error(NO_SERIAL_CHARACTERISTICS);
  }

  /** The link in the same shape as the native BLE transport's, for the diagnostics panel. The web
   *  has no MTU API, so it always reports the 23-byte default and its 20-byte payload. */
  get linkInfo(): BleLinkInfo | null {
    const t = this.target;
    if (!t || this.status !== 'connected') return null;
    return {
      mtu: DEFAULT_ATT_MTU,
      payload: MIN_PAYLOAD,
      service: t.service,
      notifyCharacteristic: t.notify.uuid,
      writeCharacteristic: t.write.uuid,
      writeWithoutResponse: t.withoutResponse,
    };
  }

  /** Write `bytes` in 20-byte GATT writes, strictly in order: without-response when the
   *  characteristic and the browser support it, else with response (`writeValueWithResponse`, or
   *  the older `writeValue`). Calls are queued — a write starts once the previous one settled. If
   *  a chunk fails after earlier ones went out, a best-effort `LINE_FLUSH` makes the ELM327 reject
   *  the buffered fragment (see `BleTransport.write`). */
  write(bytes: Uint8Array): Promise<void> {
    if (!this.target || this.status !== 'connected') {
      return Promise.reject(new Error('Web Bluetooth transport not connected'));
    }
    const run = this.writeChain.then(() => this.writeNow(bytes));
    this.writeChain = run.catch(() => undefined); // a failed write does not block the next one
    return run;
  }

  private async writeNow(bytes: Uint8Array): Promise<void> {
    // Re-checked: the link may have dropped while this write waited its turn.
    const t = this.target;
    if (!t || this.status !== 'connected') throw new Error('Web Bluetooth transport not connected');
    const c = t.write;
    const send = (chunk: Uint8Array): Promise<void> => {
      if (t.withoutResponse && c.writeValueWithoutResponse)
        return c.writeValueWithoutResponse(chunk);
      if (c.writeValueWithResponse) return c.writeValueWithResponse(chunk);
      return c.writeValue(chunk);
    };
    for (let offset = 0; offset < bytes.length; offset += MIN_PAYLOAD) {
      try {
        await send(bytes.slice(offset, offset + MIN_PAYLOAD));
      } catch (e) {
        if (offset > 0) {
          try {
            await send(LINE_FLUSH);
          } catch {
            // best-effort: the link is likely gone
          }
        }
        throw e;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.connectSeq++; // invalidate any connect() still in flight so it tears itself down
    this.teardown();
  }

  /** Drop the value and disconnect listeners (no status change). */
  private detach(): void {
    if (this.disconnectWatched) {
      this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
      this.disconnectWatched = false;
    }
    this.target?.notify.removeEventListener('characteristicvaluechanged', this.onValue);
    this.target = null;
    this.writeChain = Promise.resolve();
  }

  private teardown(): void {
    // Listeners first, so the browser's own 'gattserverdisconnected' for this manual close is not
    // reported as a link loss.
    this.detach();
    try {
      if (this.device.gatt?.connected) this.device.gatt.disconnect();
    } catch {
      // ignore
    }
    this.setStatus('disconnected');
  }
}
