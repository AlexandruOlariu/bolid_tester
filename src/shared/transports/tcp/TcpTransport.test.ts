/** TcpTransport against a fake socket (plan 26): every status transition, byte conversion and the
 *  teardown paths. The real `react-native-tcp-socket` is never loaded except where the default
 *  factory is tested against a virtual mock of it. */

import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  TcpConnectCancelledError,
  TcpTransport,
  defaultSocketFactory,
  type TcpSocketFactory,
} from './TcpTransport';
import { DEFAULT_WIFI_ENDPOINT } from './endpoint';
import { FakeSocket } from './testing/fakeSocket';
import type { TransportStatus } from '../../obd-core/transport/Transport';

/** Let pending promise callbacks (the factory's resolution) run. */
const flush = () => new Promise<void>((r) => setImmediate(r));

function setup(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
  const sockets: FakeSocket[] = [];
  const factory = jest.fn<ReturnType<TcpSocketFactory>, Parameters<TcpSocketFactory>>(async () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  });
  const transport = new TcpTransport(DEFAULT_WIFI_ENDPOINT, factory, timeoutMs);
  const statuses: TransportStatus[] = [];
  transport.onStatusChange((s) => statuses.push(s));
  return { transport, factory, sockets, statuses };
}

/** Connect and resolve the fake socket's `'connect'` event. */
async function connected() {
  const ctx = setup();
  const p = ctx.transport.connect();
  await flush();
  ctx.sockets[0].emitConnect();
  await p;
  return ctx;
}

describe('TcpTransport', () => {
  afterEach(() => jest.useRealTimers());

  it('connect resolves on the socket connect event and reports connected', async () => {
    const { transport, factory, sockets, statuses } = setup();
    const p = transport.connect();
    expect(transport.status).toBe('connecting');
    await flush();
    expect(factory).toHaveBeenCalledWith(DEFAULT_WIFI_ENDPOINT, DEFAULT_CONNECT_TIMEOUT_MS);
    expect(sockets[0].listenerCount('connect')).toBe(1);
    sockets[0].emitConnect();
    await expect(p).resolves.toBeUndefined();
    expect(transport.status).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(transport.address).toBe('192.168.0.10:35000');
  });

  it('a socket error before connecting rejects, reports error and closes the socket', async () => {
    const { transport, sockets, statuses } = setup();
    const p = transport.connect();
    await flush();
    sockets[0].emitError(new Error('connect ECONNREFUSED 192.168.0.10:35000'));
    await expect(p).rejects.toThrow(
      'Could not reach the Wi-Fi adapter at 192.168.0.10:35000: connect ECONNREFUSED',
    );
    expect(transport.status).toBe('error');
    expect(statuses).toEqual(['connecting', 'error']);
    expect(sockets[0].destroyed).toBe(1);
    // A later close of the failed socket is ignored.
    sockets[0].emitClose();
    expect(statuses).toEqual(['connecting', 'error']);
  });

  it('a close before connecting rejects with a refused-connection error', async () => {
    const { transport, sockets } = setup();
    const p = transport.connect();
    await flush();
    sockets[0].emitClose();
    await expect(p).rejects.toThrow(/closed the connection.*ECONNREFUSED/);
    expect(transport.status).toBe('error');
  });

  it('a factory failure (module missing) rejects with its message and reports error', async () => {
    const factory: TcpSocketFactory = async () => {
      throw new Error('Wi-Fi adapters need the TCP socket module');
    };
    const transport = new TcpTransport(DEFAULT_WIFI_ENDPOINT, factory);
    await expect(transport.connect()).rejects.toThrow('need the TCP socket module');
    expect(transport.status).toBe('error');
  });

  it('times out when the socket never connects, within the configured time', async () => {
    jest.useFakeTimers();
    const { transport, sockets, statuses } = setup(5000);
    const p = transport.connect();
    const outcome = p.then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(4999);
    expect(transport.status).toBe('connecting');
    jest.advanceTimersByTime(1);
    expect(await outcome).toBe(
      'No answer from the Wi-Fi adapter at 192.168.0.10:35000 within 5 s (ETIMEDOUT)',
    );
    expect(statuses).toEqual(['connecting', 'error']);
    expect(sockets[0].destroyed).toBe(1);
    // The late connect of the abandoned socket changes nothing.
    sockets[0].emitConnect();
    expect(transport.status).toBe('error');
  });

  it('a socket created after the timeout is closed, not leaked', async () => {
    jest.useFakeTimers();
    let release: (s: FakeSocket) => void = () => undefined;
    const late = new FakeSocket();
    const factory: TcpSocketFactory = () => new Promise((r) => (release = r));
    const transport = new TcpTransport(DEFAULT_WIFI_ENDPOINT, factory, 1000);
    const p = transport.connect().catch((e: Error) => e);
    jest.advanceTimersByTime(1000);
    expect(await p).toBeInstanceOf(Error);
    release(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late.destroyed).toBe(1);
    expect(late.listenerCount('data')).toBe(0);
  });

  it('write forwards the exact bytes to the socket', async () => {
    const { transport, sockets } = await connected();
    await transport.write(Uint8Array.from([0x30, 0x31, 0x30, 0x43, 0x0d]));
    expect(sockets[0].written).toEqual([Uint8Array.from([0x30, 0x31, 0x30, 0x43, 0x0d])]);
  });

  it('write throws when not connected', async () => {
    const { transport } = setup();
    await expect(transport.write(Uint8Array.from([0x0d]))).rejects.toThrow(
      'Wi-Fi transport not connected',
    );
  });

  it('converts Buffer and string data chunks to Uint8Array', async () => {
    const { transport, sockets } = await connected();
    const got: Uint8Array[] = [];
    transport.onData((b) => got.push(b));
    sockets[0].emitData(Buffer.from('41 0C 0C D0\r'));
    sockets[0].emitData('\r>');
    sockets[0].emitData('');
    expect(got).toHaveLength(2);
    expect(got[0]).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(got[0])).toBe(false);
    expect(Array.from(got[0])).toEqual(Array.from(Buffer.from('41 0C 0C D0\r')));
    expect(Array.from(got[1])).toEqual([0x0d, 0x3e]);
  });

  it('an unsubscribed data listener gets nothing more', async () => {
    const { transport, sockets } = await connected();
    const got: Uint8Array[] = [];
    const off = transport.onData((b) => got.push(b));
    off();
    sockets[0].emitData('OK\r>');
    expect(got).toHaveLength(0);
  });

  it('an unsolicited close emits disconnected exactly once', async () => {
    const { transport, sockets, statuses } = await connected();
    sockets[0].emitClose();
    sockets[0].emitClose();
    expect(transport.status).toBe('disconnected');
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    expect(sockets[0].destroyed).toBe(1);
    await expect(transport.write(Uint8Array.from([0x0d]))).rejects.toThrow('not connected');
  });

  it('an unsolicited error emits error, and the following close is ignored', async () => {
    const { transport, sockets, statuses } = await connected();
    sockets[0].emitError(new Error('read ECONNRESET'));
    sockets[0].emitClose();
    expect(transport.status).toBe('error');
    expect(statuses).toEqual(['connecting', 'connected', 'error']);
  });

  it('manual disconnect destroys the socket and emits only disconnected', async () => {
    const { transport, sockets, statuses } = await connected();
    await transport.disconnect();
    expect(sockets[0].destroyed).toBe(1);
    expect(transport.status).toBe('disconnected');
    // The socket's own close / error after a manual close are not reported.
    sockets[0].emitError(new Error('socket closed'));
    sockets[0].emitClose();
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    expect(statuses).not.toContain('error');
  });

  it('disconnect during connect cancels it without an error status', async () => {
    const { transport, sockets, statuses } = setup();
    const p = transport.connect();
    await flush();
    await transport.disconnect();
    await expect(p).rejects.toBeInstanceOf(TcpConnectCancelledError);
    expect(sockets[0].destroyed).toBe(1);
    expect(statuses).toEqual(['connecting', 'disconnected']);
  });

  it('reconnects with a fresh socket after a drop', async () => {
    const { transport, sockets, statuses } = await connected();
    sockets[0].emitClose();
    const p = transport.connect();
    await flush();
    expect(sockets).toHaveLength(2);
    sockets[1].emitConnect();
    await p;
    expect(statuses).toEqual([
      'connecting',
      'connected',
      'disconnected',
      'connecting',
      'connected',
    ]);
    // Data from the old socket is ignored; the new one is live.
    const got: number[][] = [];
    transport.onData((b) => got.push(Array.from(b)));
    sockets[0].emitData('OLD');
    sockets[1].emitData('>');
    expect(got).toEqual([[0x3e]]);
  });
});

describe('defaultSocketFactory', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native-tcp-socket');
  });

  it('throws a plain-English error when the TCP module is absent', async () => {
    jest.doMock('react-native-tcp-socket', () => ({}), { virtual: true });
    await expect(defaultSocketFactory(DEFAULT_WIFI_ENDPOINT, 5000)).rejects.toThrow(
      /need the TCP socket module/,
    );
  });

  it('opens the socket with host, port and connectTimeout and adapts its events', async () => {
    type Cb = (...args: unknown[]) => void;
    const handlers: Record<string, Cb[]> = {};
    const raw = {
      write: jest.fn(),
      destroy: jest.fn(),
      setNoDelay: jest.fn(),
      on: jest.fn((event: string, cb: Cb) => {
        (handlers[event] ??= []).push(cb);
      }),
    };
    let onConnect: () => void = () => undefined;
    const createConnection = jest.fn((_opts: unknown, cb: () => void) => {
      onConnect = cb;
      return raw;
    });
    jest.doMock(
      'react-native-tcp-socket',
      () => ({ __esModule: true, default: { createConnection } }),
      {
        virtual: true,
      },
    );

    const socket = await defaultSocketFactory({ host: '10.0.0.5', port: 23 }, 4000);
    expect(createConnection).toHaveBeenCalledWith(
      { host: '10.0.0.5', port: 23, connectTimeout: 4000 },
      expect.any(Function),
    );
    const connects: string[] = [];
    socket.on('connect', () => connects.push('early'));
    onConnect();
    expect(connects).toEqual(['early']);
    expect(raw.setNoDelay).toHaveBeenCalledWith(true);
    // A listener added after the socket connected still hears about it (next tick).
    socket.on('connect', () => connects.push('late'));
    await new Promise((r) => setTimeout(r, 5));
    expect(connects).toEqual(['early', 'late']);

    const chunks: unknown[] = [];
    socket.on('data', (c) => chunks.push(c));
    handlers.data[0]('41 0C');
    expect(chunks).toEqual(['41 0C']);
    socket.write(Uint8Array.from([0x0d]));
    expect(raw.write).toHaveBeenCalledWith(Uint8Array.from([0x0d]));
    socket.destroy();
    expect(raw.destroy).toHaveBeenCalled();
  });
});
