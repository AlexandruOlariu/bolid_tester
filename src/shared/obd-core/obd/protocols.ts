/** OBD2 transport protocols and ELM327 protocol-number mapping. */

export type ProtocolId =
  | 'AUTO'
  | 'SAE_J1850_PWM'
  | 'SAE_J1850_VPW'
  | 'ISO_9141_2'
  | 'ISO_14230_4_KWP_5BAUD'
  | 'ISO_14230_4_KWP_FAST'
  | 'ISO_15765_4_CAN_11_500'
  | 'ISO_15765_4_CAN_29_500'
  | 'ISO_15765_4_CAN_11_250'
  | 'ISO_15765_4_CAN_29_250'
  | 'SAE_J1939'
  | 'UNKNOWN';

/** ELM327 `ATSPn` / `ATDPN` protocol numbers. */
const ELM_NUMBER_TO_PROTOCOL: Record<string, ProtocolId> = {
  '0': 'AUTO',
  '1': 'SAE_J1850_PWM',
  '2': 'SAE_J1850_VPW',
  '3': 'ISO_9141_2',
  '4': 'ISO_14230_4_KWP_5BAUD',
  '5': 'ISO_14230_4_KWP_FAST',
  '6': 'ISO_15765_4_CAN_11_500',
  '7': 'ISO_15765_4_CAN_29_500',
  '8': 'ISO_15765_4_CAN_11_250',
  '9': 'ISO_15765_4_CAN_29_250',
  A: 'SAE_J1939',
};

export const PROTOCOL_LABELS: Record<ProtocolId, string> = {
  AUTO: 'Auto',
  SAE_J1850_PWM: 'SAE J1850 PWM',
  SAE_J1850_VPW: 'SAE J1850 VPW',
  ISO_9141_2: 'ISO 9141-2 (K-line)',
  ISO_14230_4_KWP_5BAUD: 'ISO 14230-4 KWP2000 (5-baud init)',
  ISO_14230_4_KWP_FAST: 'ISO 14230-4 KWP2000 (fast init)',
  ISO_15765_4_CAN_11_500: 'ISO 15765-4 CAN (11-bit, 500 kbps)',
  ISO_15765_4_CAN_29_500: 'ISO 15765-4 CAN (29-bit, 500 kbps)',
  ISO_15765_4_CAN_11_250: 'ISO 15765-4 CAN (11-bit, 250 kbps)',
  ISO_15765_4_CAN_29_250: 'ISO 15765-4 CAN (29-bit, 250 kbps)',
  SAE_J1939: 'SAE J1939 (CAN)',
  UNKNOWN: 'Unknown',
};

/**
 * Parse the output of `ATDPN`. The ELM327 prefixes an `A` when the protocol was
 * auto-detected (e.g. `A6`), so we strip a leading `A` and read the trailing digit/letter.
 */
export function protocolFromElmNumber(raw: string): ProtocolId {
  const token = raw.trim().toUpperCase().replace(/[^0-9A]/g, '');
  const key = token.replace(/^A(?=.)/, '').slice(-1);
  return ELM_NUMBER_TO_PROTOCOL[key] ?? 'UNKNOWN';
}

/** Map a protocol id back to its ELM327 number (for `ATSPn`). Defaults to auto. */
export function elmNumberFromProtocol(id: ProtocolId): string {
  const entry = Object.entries(ELM_NUMBER_TO_PROTOCOL).find(([, v]) => v === id);
  return entry ? entry[0] : '0';
}

export function isCan(id: ProtocolId): boolean {
  return id.startsWith('ISO_15765') || id === 'SAE_J1939';
}

export function isKLine(id: ProtocolId): boolean {
  return id === 'ISO_9141_2' || id.startsWith('ISO_14230');
}
