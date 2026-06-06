/** The byte-pipe abstraction the whole stack sits on. Implemented by BLE, the mock simulator,
 *  and (later) Web Bluetooth. See docs/architecture.md. */

export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  /** Subscribe to inbound bytes. Returns an unsubscribe function. */
  onData(listener: (bytes: Uint8Array) => void): () => void;
  readonly status: TransportStatus;
}
