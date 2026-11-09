/** Transport implementation over a TCP socket, for Wi-Fi ELM327 adapters (plan 26). The adapter is
 *  a plain byte pipe on `host:port` (usually `192.168.0.10:35000`), so the whole stack above —
 *  ELM client, session, every feature — is unchanged. The socket is injected (`TcpSocketFactory`),
 *  so the transport is unit-tested against a fake; the app uses `defaultSocketFactory`, which loads
 *  `react-native-tcp-socket` through a variable specifier (absent under Jest / web).
 *
 *  Status transitions mirror BleTransport: `connecting` → `connected` (or `error` when the socket
 *  errors, closes or times out before connecting); an unsolicited `close` after connecting →
 *  `disconnected`, an unsolicited `error` → `error`, so connectionService's status watcher handles a
 *  Wi-Fi drop exactly like a BLE one (auto-reconnect included). A manual `disconnect()` emits only
 *  `disconnected`. See docs/features/connection.md § Wi-Fi. */

import { Transport, TransportStatus } from '../../obd-core/transport/Transport';
import { stringToBytes } from '../../lib/bytes';
import { formatEndpoint, type TcpEndpoint } from './endpoint';

export type { TcpEndpoint } from './endpoint';

/** The socket surface the transport needs — a subset of `react-native-tcp-socket`'s `Socket`. */
export interface TcpSocketLike {
  write(data: Uint8Array): void;
  destroy(): void;
  on(event: 'connect', cb: () => void): void;
  on(event: 'data', cb: (chunk: Uint8Array | string) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
  on(event: 'close', cb: () => void): void;
}

/** Open a socket to `ep`. Resolves with the socket as soon as it exists (the connection may still
 *  be in progress — the transport waits for its `'connect'` event). */
export type TcpSocketFactory = (
  ep: TcpEndpoint,
  connectTimeoutMs: number,
) => Promise<TcpSocketLike>;

/** How long a connect may take before it fails (the acceptance check: within 5 s). */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** Thrown into an in-flight `connect()` that a `disconnect()` (or a newer connect) cancelled. */
export class TcpConnectCancelledError extends Error {
  constructor() {
    super('Wi-Fi connect cancelled');
    this.name = 'TcpConnectCancelledError';
  }
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

function safeDestroy(socket: TcpSocketLike): void {
  try {
    socket.destroy();
  } catch {
    // best-effort: the socket is being dropped either way
  }
}

export class TcpTransport implements Transport {
  status: TransportStatus = 'disconnected';
  private socket: TcpSocketLike | null = null;
  private listeners = new Set<(b: Uint8Array) => void>();
  private statusListeners = new Set<(s: TransportStatus) => void>();
  /** Bumped by every connect() and disconnect(), so a superseded connect can tell. */
  private connectSeq = 0;
  /** Rejects the in-flight connect() (set while one is pending). */
  private cancelPending: (() => void) | null = null;

  constructor(
    private readonly endpoint: TcpEndpoint,
    private readonly factory: TcpSocketFactory = defaultSocketFactory,
    private readonly connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  ) {}

  /** `host:port` this transport connects to. */
  get address(): string {
    return formatEndpoint(this.endpoint);
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

  /** Hand a socket chunk to the listeners: a string (a socket with an encoding set) is converted
   *  with `stringToBytes`, a Buffer is copied into a plain `Uint8Array`. */
  private emit(chunk: Uint8Array | string): void {
    const bytes = typeof chunk === 'string' ? stringToBytes(chunk) : Uint8Array.from(chunk);
    if (bytes.length === 0) return;
    for (const l of [...this.listeners]) l(bytes);
  }

  /** Forget the current socket (its later events are ignored) and close it. */
  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) safeDestroy(socket);
  }

  async connect(): Promise<void> {
    const token = ++this.connectSeq;
    this.cancelPending?.();
    this.dropSocket();
    this.setStatus('connecting');
    const where = this.address;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.cancelPending = null;
          if (err) reject(err);
          else resolve();
        };
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                `No answer from the Wi-Fi adapter at ${where} within ` +
                  `${Math.round(this.connectTimeoutMs / 1000)} s (ETIMEDOUT)`,
              ),
            ),
          this.connectTimeoutMs,
        );
        this.cancelPending = () => finish(new TcpConnectCancelledError());

        this.factory(this.endpoint, this.connectTimeoutMs).then(
          (socket) => {
            if (settled || token !== this.connectSeq) {
              // Timed out or cancelled while the socket was being created: close it, never leak it.
              safeDestroy(socket);
              return;
            }
            this.socket = socket;
            socket.on('connect', () => {
              if (this.socket === socket) finish();
            });
            socket.on('data', (chunk) => {
              if (this.socket === socket) this.emit(chunk);
            });
            socket.on('error', (e) => {
              if (this.socket !== socket) return;
              if (!settled) {
                finish(
                  new Error(`Could not reach the Wi-Fi adapter at ${where}: ${toError(e).message}`),
                );
              } else this.lose('error');
            });
            socket.on('close', () => {
              if (this.socket !== socket) return;
              if (!settled) {
                finish(
                  new Error(
                    `The Wi-Fi adapter at ${where} closed the connection before it opened ` +
                      `(ECONNREFUSED)`,
                  ),
                );
              } else this.lose('disconnected');
            });
          },
          (e) => finish(toError(e)),
        );
      });
    } catch (e) {
      // A disconnect() (or a newer connect()) superseded this one and already set the status.
      if (token === this.connectSeq) {
        this.dropSocket();
        this.setStatus('error');
      }
      throw e;
    }
    this.setStatus('connected');
  }

  /** The live socket closed or failed on its own (adapter unplugged, phone left its network). */
  private lose(status: 'disconnected' | 'error'): void {
    this.dropSocket();
    this.setStatus(status);
  }

  async write(bytes: Uint8Array): Promise<void> {
    const socket = this.socket;
    if (!socket || this.status !== 'connected') throw new Error('Wi-Fi transport not connected');
    socket.write(bytes);
  }

  async disconnect(): Promise<void> {
    this.connectSeq++; // a connect() still in flight is superseded
    this.cancelPending?.();
    this.dropSocket();
    this.setStatus('disconnected');
  }
}

const TCP_MODULE_MISSING =
  'Wi-Fi adapters need the TCP socket module, which this build of the app does not include. ' +
  'Use a development or release build (not Expo Go or the web version).';

/** The part of `react-native-tcp-socket`'s `Socket` the default factory calls. */
interface RnTcpSocket {
  write(data: Uint8Array): unknown;
  destroy(): unknown;
  setNoDelay?(noDelay?: boolean): unknown;
  on(event: string, cb: (...args: never[]) => void): unknown;
}

interface RnTcpModule {
  createConnection(
    options: { host: string; port: number; connectTimeout?: number },
    onConnect: () => void,
  ): RnTcpSocket;
}

/** Load `react-native-tcp-socket`, or undefined when it is absent (Jest, web, Expo Go). The
 *  variable specifier keeps the type checker and Jest from resolving the native module. */
async function loadTcpModule(): Promise<Partial<RnTcpModule> | undefined> {
  try {
    const mod = (await import('react-native-tcp-socket' as string)) as Partial<RnTcpModule> & {
      default?: Partial<RnTcpModule>;
    };
    return typeof mod.createConnection === 'function' ? mod : mod.default;
  } catch {
    return undefined;
  }
}

/** Opens a socket with `react-native-tcp-socket` (`createConnection({ host, port, connectTimeout })`)
 *  and adapts it to `TcpSocketLike`. Throws a plain-English error when the module is absent. Nagle
 *  is turned off once connected: ELM327 commands are a few bytes and each one waits for its reply.
 *  The library takes its connect callback at creation, so a `'connect'` listener added after the
 *  socket already connected is called on the next tick instead of being missed. */
export const defaultSocketFactory: TcpSocketFactory = async (ep, connectTimeoutMs) => {
  const lib = await loadTcpModule();
  if (!lib || typeof lib.createConnection !== 'function') throw new Error(TCP_MODULE_MISSING);

  let connected = false;
  const connectListeners: (() => void)[] = [];
  const raw = lib.createConnection(
    { host: ep.host, port: ep.port, connectTimeout: connectTimeoutMs },
    () => {
      connected = true;
      try {
        raw.setNoDelay?.(true);
      } catch {
        // optional tuning only
      }
      for (const cb of connectListeners.splice(0)) cb();
    },
  );

  const on = (event: string, cb: (...args: never[]) => void): void => {
    if (event !== 'connect') {
      raw.on(event, cb);
      return;
    }
    const onConnect = cb as () => void;
    if (connected) setTimeout(onConnect, 0);
    else connectListeners.push(onConnect);
  };
  return {
    write: (data) => {
      raw.write(data);
    },
    destroy: () => {
      raw.destroy();
    },
    on: on as TcpSocketLike['on'],
  };
};
