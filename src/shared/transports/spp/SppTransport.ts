/** Transport implementation over Classic Bluetooth (RFCOMM / Serial Port Profile), for the cheap
 *  "Bluetooth 3.0" ELM327 adapters that `react-native-ble-plx` cannot reach (plan 27). Android only:
 *  iOS opens classic accessories only through MFi, which ELM327 clones never are.
 *
 *  `react-native-bluetooth-classic` is injected as an `SppModuleLike` loader (a fake in tests;
 *  `defaultSppModule` in the app). It delivers data **per delimiter**, delimiter stripped: the link
 *  opens with `delimiter: '>'` (the ELM327 prompt) and the prompt is re-appended to every message.
 *  So monitor mode (`ATMA`, lines end in `\r` with no prompt) cannot stream: `capabilities.monitor`
 *  is false. Status transitions mirror TcpTransport. See docs/features/connection.md. */

import type {
  Transport,
  TransportCapabilities,
  TransportStatus,
} from '../../obd-core/transport/Transport';
import { bytesToString, stringToBytes } from '../../lib/bytes';
import { looksLikeAdapter } from '../adapterNames';

/** The ELM327 prompt — the library's message delimiter on this link. */
export const ELM_PROMPT = '>';

/** Options the link is opened with: one message per ELM327 prompt, plain ASCII. */
export const SPP_CONNECT_OPTIONS = { delimiter: ELM_PROMPT, charset: 'ascii' } as const;

/** A connected device — the subset of the library's `BluetoothDevice` the transport needs. */
export interface SppDeviceLike {
  write(data: string): Promise<boolean>;
  /** One event per delimiter-terminated message, delimiter stripped. */
  onDataReceived(cb: (ev: { data: string }) => void): { remove(): void };
  disconnect(): Promise<boolean>;
}

/** The subset of the library's module (`RNBluetoothClassic`) the transport and the bonded-device
 *  list need. */
export interface SppModuleLike {
  connectToDevice(
    address: string,
    opts: { delimiter: string; charset: string },
  ): Promise<SppDeviceLike>;
  /** The library's **global** `DEVICE_DISCONNECTED` event — sent only when the whole Bluetooth (ACL)
   *  link drops. */
  onDeviceDisconnected(cb: (ev: { device?: { address?: string } }) => void): { remove(): void };
  /** Subscribe to any native event by name. Used for the **per-device**
   *  `DEVICE_DISCONNECTED@<MAC>` event, which the library sends (instead of the global one) when
   *  only the RFCOMM socket closes — its read thread fails while the ACL link may stay up. */
  createBluetoothEventSubscription?(
    eventType: string,
    cb: (ev: unknown) => void,
  ): { remove(): void };
  getBondedDevices(): Promise<{ address: string; name?: string | null }[]>;
  isBluetoothEnabled(): Promise<boolean>;
}

/** The library's per-device disconnect event name (`EventType.DEVICE_DISCONNECTED` + `@` + MAC). */
export const sppSocketClosedEvent = (address: string): string => `DEVICE_DISCONNECTED@${address}`;

/** Loads the Classic Bluetooth module (injected so tests use a fake). */
export type SppModuleLoader = () => Promise<SppModuleLike>;

/** A paired (bonded) device, shaped like the Connect screen's `ScannedDevice` so it renders with
 *  the same `DeviceRow`. `rssi` is always null: bonded devices are listed, not scanned. */
export interface BondedAdapter {
  /** The Bluetooth MAC address — what `SppTransport` connects to. */
  id: string;
  name: string | null;
  rssi: number | null;
  isLikelyAdapter: boolean;
}

/** Thrown into an in-flight `connect()` that a `disconnect()` (or a newer connect) cancelled. */
export class SppConnectCancelledError extends Error {
  constructor() {
    super('Classic Bluetooth connect cancelled');
    this.name = 'SppConnectCancelledError';
  }
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

const sameAddress = (a: string | undefined, b: string): boolean =>
  !!a && a.toUpperCase() === b.toUpperCase();

/** `connecting` → `connected` (or `error` when the socket cannot be opened). A drop → `disconnected`
 *  (once), so connectionService's status watcher handles an SPP drop like a BLE one (auto-reconnect
 *  included). A drop is any of: the library's global device-disconnected event for this address
 *  (the ACL link went), its per-device `DEVICE_DISCONNECTED@<MAC>` event (only the RFCOMM socket
 *  closed), or a failed write (the library rejects "Not connected to <MAC>" once the socket is
 *  gone, or the socket write itself fails). A manual `disconnect()` emits only `disconnected`. */
export class SppTransport implements Transport {
  status: TransportStatus = 'disconnected';
  /** Monitor mode cannot stream over a delimiter-framed link (see the file comment). */
  readonly capabilities: TransportCapabilities = { monitor: false };
  private device: SppDeviceLike | null = null;
  private subs: { remove(): void }[] = [];
  private listeners = new Set<(b: Uint8Array) => void>();
  private statusListeners = new Set<(s: TransportStatus) => void>();
  /** Bumped by every connect() and disconnect(), so a superseded connect can tell. */
  private connectSeq = 0;

  constructor(
    private readonly address: string,
    private readonly loadModule: SppModuleLoader = defaultSppModule,
  ) {}

  /** The Bluetooth MAC address this transport connects to. */
  get deviceAddress(): string {
    return this.address;
  }

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

  /** One library message = one ELM327 response without its prompt: put the prompt back. */
  private emit(message: string): void {
    const bytes = stringToBytes(message + ELM_PROMPT);
    for (const l of [...this.listeners]) l(bytes);
  }

  /** Forget the current device (its later events are ignored) and drop the subscriptions. Returns
   *  the device so the caller can close it. */
  private detach(): SppDeviceLike | null {
    for (const s of this.subs.splice(0)) {
      try {
        s.remove();
      } catch {
        // best-effort
      }
    }
    const device = this.device;
    this.device = null;
    return device;
  }

  async connect(): Promise<void> {
    const token = ++this.connectSeq;
    const old = this.detach();
    if (old) void old.disconnect().catch(() => undefined);
    this.setStatus('connecting');
    let device: SppDeviceLike;
    try {
      const mod = await this.loadModule();
      if (token !== this.connectSeq) throw new SppConnectCancelledError();
      try {
        // If the library still holds a connection to this address (one this transport no longer
        // knows about, e.g. after a JS reload), it resolves with that one instead of opening a new
        // socket; this app always opens with the same SPP_CONNECT_OPTIONS, so the framing matches.
        device = await mod.connectToDevice(this.address, { ...SPP_CONNECT_OPTIONS });
      } catch (e) {
        throw new Error(
          `Could not open the Classic Bluetooth adapter ${this.address}: ${toError(e).message}`,
        );
      }
      if (token !== this.connectSeq) {
        // Cancelled while the socket was opening: close it, never leak it.
        void device.disconnect().catch(() => undefined);
        throw new SppConnectCancelledError();
      }
      this.device = device;
      this.subs.push(
        device.onDataReceived((ev) => {
          if (this.device === device) this.emit(ev.data ?? '');
        }),
        mod.onDeviceDisconnected((ev) => {
          // The adapter went away on its own (unplugged, out of range, taken by another app).
          if (sameAddress(ev.device?.address, this.address)) this.dropped(device);
        }),
      );
      if (mod.createBluetoothEventSubscription) {
        // Only the socket closed (its read thread failed): the ACL link may stay up for a while.
        this.subs.push(
          mod.createBluetoothEventSubscription(sppSocketClosedEvent(this.address), () =>
            this.dropped(device),
          ),
        );
      }
    } catch (e) {
      // A disconnect() (or a newer connect()) superseded this one and already set the status.
      if (token === this.connectSeq) {
        this.detach();
        this.setStatus('error');
      }
      throw e;
    }
    this.setStatus('connected');
  }

  /** The link to `device` is gone: forget it and report `disconnected` — once, and only while it is
   *  still the current device (a manual disconnect or a newer connect already detached it). The
   *  native connection is closed best-effort, so a later connect opens a fresh socket instead of
   *  being handed the dead one back. */
  private dropped(device: SppDeviceLike): void {
    if (this.device !== device) return;
    this.detach();
    void device.disconnect().catch(() => undefined);
    this.setStatus('disconnected');
  }

  async write(bytes: Uint8Array): Promise<void> {
    const device = this.device;
    if (!device || this.status !== 'connected') {
      throw new Error('Classic Bluetooth transport not connected');
    }
    let ok: boolean;
    try {
      ok = await device.write(bytesToString(bytes));
    } catch (e) {
      // Every write rejection is fatal to the link ("Not connected to <MAC>" once the socket is
      // gone, a socket IOException, Bluetooth off): report the drop so the reconnect logic runs.
      this.dropped(device);
      throw new Error(`Classic Bluetooth write failed: ${toError(e).message}`);
    }
    if (ok === false) {
      this.dropped(device);
      throw new Error('Classic Bluetooth write failed (socket closed)');
    }
  }

  async disconnect(): Promise<void> {
    this.connectSeq++; // a connect() still in flight is superseded
    // Unsubscribe first, so the library's disconnect event for this close is not a "drop".
    const device = this.detach();
    if (device) {
      try {
        await device.disconnect();
      } catch {
        // best-effort: the socket is being dropped either way
      }
    }
    this.setStatus('disconnected');
  }
}

/** Paired devices from the phone's Bluetooth settings, likely adapters first (then by name). There
 *  is no scanning: an SPP adapter must be paired in Android Settings → Bluetooth first. Throws a
 *  plain-English error when Bluetooth is off or the module is absent. */
export async function listBondedAdapters(
  load: SppModuleLoader = defaultSppModule,
): Promise<BondedAdapter[]> {
  const mod = await load();
  if (!(await mod.isBluetoothEnabled())) {
    throw new Error('Bluetooth is off. Turn Bluetooth on, then refresh the list.');
  }
  const bonded = await mod.getBondedDevices();
  return bonded
    .map((d) => ({
      id: d.address,
      name: d.name ?? null,
      rssi: null,
      isLikelyAdapter: looksLikeAdapter(d.name),
    }))
    .sort((a, b) => {
      if (a.isLikelyAdapter !== b.isLikelyAdapter) return a.isLikelyAdapter ? -1 : 1;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
}

/** Shown when the native module is absent (web, Expo Go, iOS, tests). */
export const SPP_MODULE_MISSING =
  'Classic Bluetooth is not available in this build. It works only in the Android app (a ' +
  'development or release build, not Expo Go or the web version).';

/** Loads `react-native-bluetooth-classic` (its default export is the module instance). The variable
 *  specifier keeps the type checker and Jest from resolving the native module. */
export const defaultSppModule: SppModuleLoader = async () => {
  let mod: (Partial<SppModuleLike> & { default?: Partial<SppModuleLike> }) | undefined;
  try {
    mod = (await import('react-native-bluetooth-classic' as string)) as Partial<SppModuleLike> & {
      default?: Partial<SppModuleLike>;
    };
  } catch {
    mod = undefined;
  }
  const lib = mod && typeof mod.connectToDevice === 'function' ? mod : mod?.default;
  if (
    !lib ||
    typeof lib.connectToDevice !== 'function' ||
    typeof lib.getBondedDevices !== 'function'
  ) {
    throw new Error(SPP_MODULE_MISSING);
  }
  return lib as SppModuleLike;
};
