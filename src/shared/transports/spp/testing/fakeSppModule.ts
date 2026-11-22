/** Test-only fakes for `SppTransport` (plan 27): a scriptable `SppDeviceLike` / `SppModuleLike`, and
 *  a device that plays a Classic Bluetooth ELM327 through the shared simulator bridge
 *  (`bridgeToMock`), re-chunking the simulator's output **by `>`** and stripping the delimiter the
 *  way `react-native-bluetooth-classic` does — so the transport's "re-append the prompt" logic runs
 *  end to end. Never imported by app code. */

import { bytesToString, stringToBytes } from '../../../lib/bytes';
import type { MockBridge } from '../../../obd-core/transport/testing/bridge';
import type { SppDeviceLike, SppModuleLike } from '../SppTransport';

type DataCb = (ev: { data: string }) => void;
type DisconnectCb = (ev: { device?: { address?: string } }) => void;

/** A device whose inbound messages the test fires by hand (`emitData`). */
export class FakeSppDevice implements SppDeviceLike {
  /** Every string the transport wrote, in order. */
  readonly written: string[] = [];
  disconnects = 0;
  /** What `write` resolves with (the library resolves false on a closed socket). */
  writeResult = true;
  /** When set, `write` rejects with it (the library rejects "Not connected to <MAC>" once the
   *  socket is gone). */
  writeError: Error | null = null;
  private dataCbs = new Set<DataCb>();

  async write(data: string): Promise<boolean> {
    this.written.push(data);
    if (this.writeError) throw this.writeError;
    return this.writeResult;
  }
  onDataReceived(cb: DataCb): { remove(): void } {
    this.dataCbs.add(cb);
    return { remove: () => this.dataCbs.delete(cb) };
  }
  async disconnect(): Promise<boolean> {
    this.disconnects++;
    return true;
  }
  /** Deliver one delimiter-stripped message, as the library would. */
  emitData(data: string): void {
    for (const cb of [...this.dataCbs]) cb({ data });
  }
  /** Number of live data subscriptions. */
  get listenerCount(): number {
    return this.dataCbs.size;
  }
}

/** A module whose devices, bonded list and disconnect events the test controls. */
export class FakeSppModule implements SppModuleLike {
  enabled = true;
  bonded: { address: string; name?: string | null }[] = [];
  /** Every `connectToDevice` call (address + options). */
  readonly connects: { address: string; opts: { delimiter: string; charset: string } }[] = [];
  private disconnectCbs = new Set<DisconnectCb>();
  /** Named-event subscriptions (`createBluetoothEventSubscription`), e.g. `DEVICE_DISCONNECTED@<MAC>`. */
  private eventCbs = new Map<string, Set<(ev: unknown) => void>>();

  /** `makeDevice` builds the device a connect resolves with; a throw / rejection fails the connect. */
  constructor(
    private makeDevice: (address: string) => SppDeviceLike | Promise<SppDeviceLike> = () =>
      new FakeSppDevice(),
  ) {}

  async connectToDevice(
    address: string,
    opts: { delimiter: string; charset: string },
  ): Promise<SppDeviceLike> {
    this.connects.push({ address, opts });
    return this.makeDevice(address);
  }
  onDeviceDisconnected(cb: DisconnectCb): { remove(): void } {
    this.disconnectCbs.add(cb);
    return { remove: () => this.disconnectCbs.delete(cb) };
  }
  async getBondedDevices() {
    return this.bonded;
  }
  async isBluetoothEnabled() {
    return this.enabled;
  }
  createBluetoothEventSubscription(eventType: string, cb: (ev: unknown) => void) {
    const set = this.eventCbs.get(eventType) ?? new Set();
    set.add(cb);
    this.eventCbs.set(eventType, set);
    return { remove: () => set.delete(cb) };
  }
  /** Fire the library's global device-disconnected event for `address` (the ACL link dropped). */
  emitDisconnected(address: string): void {
    for (const cb of [...this.disconnectCbs]) cb({ device: { address } });
  }
  /** Fire the library's per-device `DEVICE_DISCONNECTED@<address>` event (only the RFCOMM socket
   *  closed; the payload is the read thread's exception, no device). */
  emitSocketClosed(address: string): void {
    for (const cb of [...(this.eventCbs.get(`DEVICE_DISCONNECTED@${address}`) ?? [])]) {
      cb({ message: 'bt socket closed, read return: -1' });
    }
  }
  /** Number of live disconnect subscriptions (global and per-device). */
  get disconnectListenerCount(): number {
    let n = this.disconnectCbs.size;
    for (const set of this.eventCbs.values()) n += set.size;
    return n;
  }
}

/** A fake device that plays the adapter from `bridge`: every write goes to the simulator; the
 *  simulator's output is buffered and handed back one message per `>` with the `>` removed —
 *  exactly the library's `delimiter: '>'` framing. */
export function sppDeviceOverBridge(bridge: MockBridge): FakeSppDevice {
  const device = new FakeSppDevice();
  const write = device.write.bind(device);
  device.write = async (data: string) => {
    const ok = await write(data);
    bridge.write(stringToBytes(data));
    return ok;
  };
  let buffer = '';
  bridge.onData((bytes) => {
    buffer += bytesToString(bytes);
    let i: number;
    while ((i = buffer.indexOf('>')) !== -1) {
      const message = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      device.emitData(message);
    }
  });
  return device;
}
