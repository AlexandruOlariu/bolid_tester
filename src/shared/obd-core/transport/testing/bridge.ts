/** Test bridge (plan 26, reused by plans 27 and 28): drive any fake socket / device from a
 *  `MockTransport`, so a new `Transport` can be integration-tested through `DiagnosticSession` with
 *  no hardware. Bytes written to the bridge reach the virtual ELM327; its replies come back through
 *  `onData`. Test-only — not exported from the obd-core barrel. See docs/simulator.md. */

import { MockTransport, type SimScenario } from '../MockTransport';

export interface MockBridge {
  /** Bytes the fake device received from the transport under test (forwarded to the simulator). */
  write(bytes: Uint8Array): void;
  /** Subscribe to the simulator's replies (what the fake device sends back). */
  onData(cb: (b: Uint8Array) => void): () => void;
  /** The simulator behind the bridge, for scenario hooks (`dropResponses`, …). */
  mock: MockTransport;
}

/** A connected `MockTransport` for `scenario`, wrapped as a raw byte pipe. A write the simulator
 *  rejects (its link closed) is dropped silently, like bytes sent into a dead socket. */
export function bridgeToMock(scenario: SimScenario): MockBridge {
  const mock = new MockTransport(scenario);
  // MockTransport.connect() has no await: its status is 'connected' as soon as it is called.
  void mock.connect();
  return {
    write: (bytes) => {
      mock.write(bytes).catch(() => undefined);
    },
    onData: (cb) => mock.onData(cb),
    mock,
  };
}
