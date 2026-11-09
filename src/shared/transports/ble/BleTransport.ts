/** Transport implementation over react-native-ble-plx. Discovers the notify + write characteristics
 *  at runtime (no hard-coded UUIDs), so it works across ELM327 BLE clones. Reads the negotiated ATT
 *  MTU after connecting and chunks every write to the usable payload, so a long command (a 16-byte
 *  UDS `2E` coding write is 39 bytes) survives a link where MTU negotiation failed. See
 *  docs/adapter-vgate-icar-pro.md and docs/features/connection.md. */

import { Platform } from 'react-native';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Transport, TransportStatus } from '../../obd-core/transport/Transport';
import { base64ToBytes, bytesToBase64 } from '../../lib/base64';
import { DEFAULT_ATT_MTU, LINE_FLUSH, payloadForMtu, type BleLinkInfo } from '../common/gatt';

/** Shared with the Web Bluetooth transport (plan 28); re-exported for existing importers. */
export { DEFAULT_ATT_MTU, LINE_FLUSH, payloadForMtu, type BleLinkInfo };

/** The MTU asked for on Android (iOS negotiates on its own and rejects an explicit request). */
export const REQUESTED_MTU = 247;

interface WriteTarget {
  service: string;
  characteristic: string;
  notifyCharacteristic: string;
  withoutResponse: boolean;
}

export class BleTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private device: Device | null = null;
  private monitor: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private writeTarget: WriteTarget | null = null;
  private mtu = DEFAULT_ATT_MTU;
  private listeners = new Set<(b: Uint8Array) => void>();
  private statusListeners = new Set<(s: TransportStatus) => void>();
  /** Bumped by disconnect() (and each connect()) so an in-flight connect() can detect it was
   *  superseded and tear its half-built connection back down instead of leaking it. */
  private connectSeq = 0;

  constructor(
    private manager: BleManager,
    private deviceId: string,
  ) {}

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

  async connect(): Promise<void> {
    const token = ++this.connectSeq;
    this.setStatus('connecting');
    try {
      // Only Android takes an explicit MTU request; iOS negotiates by itself. Either way the stack
      // reports the negotiated value on `device.mtu`, read below.
      const options = Platform.OS === 'android' ? { requestMTU: REQUESTED_MTU } : {};
      const device = await this.manager.connectToDevice(this.deviceId, options);
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;
      this.mtu = typeof device.mtu === 'number' && device.mtu > 0 ? device.mtu : DEFAULT_ATT_MTU;
      await this.selectCharacteristics(device);
      if (token !== this.connectSeq) {
        // A disconnect() (or a newer connect()) landed while we were connecting — the live
        // connection + monitor we just wired up would otherwise leak. Tear it back down.
        await this.teardown();
        return;
      }
      this.disconnectSub = device.onDisconnected(() => {
        // Unsolicited link loss (adapter pulled, out of range). Emit so the session layer can
        // flip the app to disconnected instead of grinding through per-command timeouts.
        this.setStatus('disconnected');
      });
      this.setStatus('connected');
    } catch (e) {
      this.setStatus('error');
      // The OS-level GATT connection may have been established before discovery / characteristic
      // selection threw; cancel it so it doesn't leak and block later reconnects.
      await this.manager.cancelDeviceConnection(this.deviceId).catch(() => undefined);
      this.monitor?.remove();
      this.monitor = null;
      this.disconnectSub?.remove();
      this.disconnectSub = null;
      this.device = null;
      this.writeTarget = null;
      throw e;
    }
  }

  /** Pick the first service that exposes both a notify/indicate and a write characteristic. */
  private async selectCharacteristics(device: Device): Promise<void> {
    const services = await device.services();
    for (const service of services) {
      const chars = await service.characteristics();
      const notify = chars.find((c) => c.isNotifiable || c.isIndicatable);
      const write = chars.find((c) => c.isWritableWithoutResponse || c.isWritableWithResponse);
      if (notify && write) {
        this.writeTarget = {
          service: service.uuid,
          characteristic: write.uuid,
          notifyCharacteristic: notify.uuid,
          withoutResponse: write.isWritableWithoutResponse,
        };
        this.monitor = device.monitorCharacteristicForService(
          service.uuid,
          notify.uuid,
          (_error, characteristic) => {
            const value = characteristic?.value;
            if (value) this.emit(base64ToBytes(value));
          },
        );
        return;
      }
    }
    throw new Error('No suitable notify + write characteristics found on this device');
  }

  private emit(bytes: number[]): void {
    const arr = Uint8Array.from(bytes);
    for (const l of [...this.listeners]) l(arr);
  }

  onData(listener: (bytes: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The negotiated link (MTU, payload, characteristics), or null while not connected. */
  get linkInfo(): BleLinkInfo | null {
    if (!this.device || !this.writeTarget) return null;
    return {
      mtu: this.mtu,
      payload: payloadForMtu(this.mtu),
      service: this.writeTarget.service,
      notifyCharacteristic: this.writeTarget.notifyCharacteristic,
      writeCharacteristic: this.writeTarget.characteristic,
      writeWithoutResponse: this.writeTarget.withoutResponse,
    };
  }

  /** Write `bytes`, split into payload-sized GATT writes sent strictly in order. The ELM327 buffers
   *  its UART input until the `\r`, so chunking is invisible to it. Without-response writes go
   *  back-to-back (the adapter buffers); with-response writes are paced by awaiting each ack.
   *
   *  If a chunk fails after earlier chunks went out, the adapter is holding a command fragment
   *  that the next write would be appended to (e.g. a half-sent `2E…` coding write + `010C` would
   *  run as one malformed `2E` write). Before rethrowing, a best-effort `LINE_FLUSH` (a non-hex
   *  character + `\r`) terminates the fragment so the ELM327 rejects it with `?` and sends nothing
   *  to the car — a bare `\r` would instead execute the truncated fragment. */
  async write(bytes: Uint8Array): Promise<void> {
    const device = this.device;
    const target = this.writeTarget;
    if (!device || !target) throw new Error('BLE transport not connected');
    const { service, characteristic, withoutResponse } = target;
    const size = payloadForMtu(this.mtu);
    const send = (value: string) =>
      withoutResponse
        ? device.writeCharacteristicWithoutResponseForService(service, characteristic, value)
        : device.writeCharacteristicWithResponseForService(service, characteristic, value);
    for (let offset = 0; offset < bytes.length; offset += size) {
      try {
        await send(bytesToBase64(bytes.subarray(offset, offset + size)));
      } catch (e) {
        if (offset > 0) {
          try {
            await send(bytesToBase64(LINE_FLUSH));
          } catch {
            // best-effort: the link is likely gone, and a reconnect resets the adapter anyway
          }
        }
        throw e;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.connectSeq++; // invalidate any connect() still in flight so it tears itself down
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.monitor?.remove();
    this.disconnectSub?.remove();
    this.monitor = null;
    this.disconnectSub = null;
    try {
      await this.device?.cancelConnection();
    } catch {
      // ignore
    }
    this.device = null;
    this.writeTarget = null;
    this.mtu = DEFAULT_ATT_MTU;
    this.setStatus('disconnected');
  }
}
