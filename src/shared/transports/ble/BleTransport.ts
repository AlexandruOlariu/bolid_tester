/** Transport implementation over react-native-ble-plx. Discovers the notify + write characteristics
 *  at runtime (no hard-coded UUIDs), so it works across ELM327 BLE clones. See
 *  docs/adapter-vgate-icar-pro.md and docs/features/connection.md. */

import type { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Transport, TransportStatus } from '../../obd-core/transport/Transport';
import { base64ToBytes, bytesToBase64 } from '../../lib/base64';

interface WriteTarget {
  service: string;
  characteristic: string;
  withoutResponse: boolean;
}

export class BleTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private device: Device | null = null;
  private monitor: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private writeTarget: WriteTarget | null = null;
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
      const device = await this.manager.connectToDevice(this.deviceId, { requestMTU: 247 });
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;
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

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.device || !this.writeTarget) throw new Error('BLE transport not connected');
    const value = bytesToBase64(bytes);
    const { service, characteristic, withoutResponse } = this.writeTarget;
    if (withoutResponse) {
      await this.device.writeCharacteristicWithoutResponseForService(service, characteristic, value);
    } else {
      await this.device.writeCharacteristicWithResponseForService(service, characteristic, value);
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
    this.setStatus('disconnected');
  }
}
