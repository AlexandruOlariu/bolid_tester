/** Test-only fakes for `TcpTransport` (plan 26): a scriptable `TcpSocketLike` and a socket that
 *  plays a Wi-Fi ELM327 by forwarding to the simulator through `bridgeToMock`. Never imported by
 *  app code. */

import type { TcpSocketLike } from '../TcpTransport';
import type { MockBridge } from '../../../obd-core/transport/testing/bridge';

type Handlers = {
  connect: (() => void)[];
  data: ((chunk: Uint8Array | string) => void)[];
  error: ((e: Error) => void)[];
  close: (() => void)[];
};

/** A socket whose events the test fires by hand (`emitConnect`, `emitData`, …). */
export class FakeSocket implements TcpSocketLike {
  readonly written: Uint8Array[] = [];
  destroyed = 0;
  private handlers: Handlers = { connect: [], data: [], error: [], close: [] };

  write(data: Uint8Array): void {
    this.written.push(Uint8Array.from(data));
  }
  destroy(): void {
    this.destroyed++;
  }
  on(event: 'connect', cb: () => void): void;
  on(event: 'data', cb: (chunk: Uint8Array | string) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: keyof Handlers, cb: (...args: never[]) => void): void {
    (this.handlers[event] as unknown[]).push(cb);
  }

  emitConnect(): void {
    for (const cb of [...this.handlers.connect]) cb();
  }
  emitData(chunk: Uint8Array | string): void {
    for (const cb of [...this.handlers.data]) cb(chunk);
  }
  emitError(e: Error): void {
    for (const cb of [...this.handlers.error]) cb(e);
  }
  emitClose(): void {
    for (const cb of [...this.handlers.close]) cb();
  }
  /** Number of listeners registered for `event` (0 until the transport wired the socket). */
  listenerCount(event: keyof Handlers): number {
    return this.handlers[event].length;
  }
}

/** A fake socket that connects on the next tick and plays the adapter from `bridge`: every write
 *  goes to the simulator, every simulator reply comes back as a `'data'` chunk — alternately as a
 *  Buffer-like `Uint8Array` and as a string, so both conversion paths are exercised. */
export function socketOverBridge(bridge: MockBridge): FakeSocket {
  const socket = new FakeSocket();
  const write = socket.write.bind(socket);
  socket.write = (data: Uint8Array) => {
    write(data);
    bridge.write(data);
  };
  let n = 0;
  bridge.onData((bytes) => {
    socket.emitData(n++ % 2 === 0 ? bytes : String.fromCharCode(...bytes));
  });
  setTimeout(() => socket.emitConnect(), 0);
  return socket;
}
