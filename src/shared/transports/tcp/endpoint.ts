/** Wi-Fi adapter endpoints (plan 26) — pure parsing / formatting, unit-tested in the core project.
 *  A Wi-Fi ELM327 (the `WiFi_OBDII` class) runs its own access point and listens on a fixed TCP
 *  address, almost always `192.168.0.10:35000`. See docs/features/connection.md § Wi-Fi. */

export interface TcpEndpoint {
  host: string;
  port: number;
}

/** The address nearly every `WiFi_OBDII`-class adapter listens on. */
export const DEFAULT_WIFI_ENDPOINT: TcpEndpoint = Object.freeze({
  host: '192.168.0.10',
  port: 35000,
});

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/** True for a dotted IPv4 address (`192.168.0.10`) or an RFC 1123 host name (`obd.local`). A name
 *  made only of digits and dots must be a valid IPv4 address (`192.168.0.256` is rejected). IPv6
 *  is not accepted: no Wi-Fi ELM327 serves it. */
export function isValidHost(host: string): boolean {
  if (!host || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.every((l) => /^\d+$/.test(l))) {
    return labels.length === 4 && labels.every((l) => IPV4_OCTET.test(l));
  }
  return labels.every((l) => HOST_LABEL.test(l));
}

/** True for an integer TCP port 1–65535. */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Parse `host:port` (surrounding whitespace ignored), or null when either part is invalid. The
 *  port is required: the Settings form always supplies both. */
export function parseEndpoint(text: string): TcpEndpoint | null {
  const s = text.trim();
  const colon = s.lastIndexOf(':');
  if (colon <= 0) return null;
  const host = s.slice(0, colon).trim();
  const portText = s.slice(colon + 1).trim();
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (!isValidHost(host) || !isValidPort(port)) return null;
  return { host, port };
}

/** A stored value that is a usable endpoint (a restored or hand-edited settings file is checked
 *  with this before it reaches the transport). */
export function isValidEndpoint(ep: unknown): ep is TcpEndpoint {
  if (!ep || typeof ep !== 'object') return false;
  const { host, port } = ep as Partial<TcpEndpoint>;
  return (
    typeof host === 'string' && isValidHost(host) && typeof port === 'number' && isValidPort(port)
  );
}

/** `host:port`, the form shown in the UI and used as the attempt's device id. */
export function formatEndpoint(ep: TcpEndpoint): string {
  return `${ep.host}:${ep.port}`;
}
