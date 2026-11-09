/** The byte-pipe abstraction the whole stack sits on. Implemented by BLE, Wi-Fi TCP (plan 26),
 *  Classic Bluetooth SPP (plan 27), the mock simulator and (later) Web Bluetooth. See
 *  docs/architecture.md. */

export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** What a link can carry beyond plain command / response (plan 27). */
export interface TransportCapabilities {
  /** Can stream ELM327 monitor-mode lines (`ATMA`), which end in `\r` with no `>` prompt until
   *  interrupted. False for a link that only delivers prompt-terminated messages (SPP). */
  monitor: boolean;
}

/** The message `DiagnosticSession.startSniffer` (and `Elm327Client.startMonitor`) rejects with when
 *  the transport cannot stream monitor mode. Shown as-is by the Bus sniffer screen. */
export const MONITOR_UNAVAILABLE_MESSAGE = 'Bus monitoring is not available over this adapter link';

/** Whether `transport` can stream monitor mode: an absent `capabilities` means it can. */
export function canStreamMonitor(transport: Pick<Transport, 'capabilities'>): boolean {
  return transport.capabilities?.monitor !== false;
}

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  /** Subscribe to inbound bytes. Returns an unsubscribe function. */
  onData(listener: (bytes: Uint8Array) => void): () => void;
  /** Subscribe to link status transitions (connecting / connected / disconnected / error).
   *  Fires only when `status` actually changes — including an unsolicited drop (e.g. the BLE
   *  adapter is pulled), which is otherwise invisible to the layers above. Returns an unsubscribe
   *  function. */
  onStatusChange(listener: (status: TransportStatus) => void): () => void;
  readonly status: TransportStatus;
  /** Optional; absent means `{ monitor: true }` (BLE, TCP, the simulator). */
  readonly capabilities?: TransportCapabilities;
}
