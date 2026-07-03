/** UDS (ISO 14229) per-module diagnostics used by the module scan ("auto-scan") and fault-code
 *  features: ReadDTCInformation (0x19), ClearDiagnosticInformation (0x14) and the standard
 *  identification DIDs (0xF187…). Pure functions over an injectable `UdsSend` — unit-testable with
 *  no hardware, exercised end-to-end against the simulator. CAN/UDS modules only; K-line cars keep
 *  using the generic OBD2 Modes 03/07/0A for the engine ECU. */

import { UdsSend, UdsError, checkNegative, hexBytes as hex } from '../coding/udsCoding';
import { decodeDtcBytes, describeDtc, vagCodeForDtc } from '../obd/dtc';
import { vagDtcText } from './vagDtcs';

/** ISO 14229 DTC status byte, bit-decoded. */
export interface UdsDtcStatus {
  testFailed: boolean;
  testFailedThisCycle: boolean;
  pending: boolean;
  confirmed: boolean;
  notCompletedSinceClear: boolean;
  failedSinceClear: boolean;
  notCompletedThisCycle: boolean;
  warningIndicator: boolean;
}

export function decodeDtcStatusByte(status: number): UdsDtcStatus {
  return {
    testFailed: !!(status & 0x01),
    testFailedThisCycle: !!(status & 0x02),
    pending: !!(status & 0x04),
    confirmed: !!(status & 0x08),
    notCompletedSinceClear: !!(status & 0x10),
    failedSinceClear: !!(status & 0x20),
    notCompletedThisCycle: !!(status & 0x40),
    warningIndicator: !!(status & 0x80),
  };
}

/** A 3-byte UDS DTC + status as reported by 0x19 0x02. */
export interface UdsDtc {
  /** Raw [high, middle, low(failure type)] bytes. */
  bytes: [number, number, number];
  /** SAE code from the first two bytes, e.g. 'P0299'. */
  sae: string;
  /** Third byte — the failure-type suffix UDS adds (e.g. P029900). */
  failureType: number;
  /** Display form 'P0299 00'. */
  display: string;
  /** VAG decimal for the first two bytes (the number VCDS shows), e.g. '00665'. */
  vagCode: string;
  status: number;
  statusFlags: UdsDtcStatus;
  description: string;
}

function toUdsDtc(hi: number, mid: number, lo: number, status: number): UdsDtc {
  const sae = decodeDtcBytes(hi, mid);
  const vagCode = vagCodeForDtc(sae);
  const vagText = vagDtcText(vagCode);
  return {
    bytes: [hi, mid, lo],
    sae,
    failureType: lo,
    display: `${sae} ${lo.toString(16).padStart(2, '0').toUpperCase()}`,
    vagCode,
    status,
    statusFlags: decodeDtcStatusByte(status),
    description: vagText ?? describeDtc(sae),
  };
}

/** Parse a positive 0x59 0x02 response: [0x59, 0x02, availabilityMask, (hi mid lo status)*]. */
export function parseReportDtcByStatusMask(res: number[]): UdsDtc[] {
  if (res.length < 3 || res[0] !== 0x59 || res[1] !== 0x02) {
    throw new UdsError(`Not a ReportDTCByStatusMask response (${hex(res.slice(0, 3))}…)`);
  }
  const out: UdsDtc[] = [];
  for (let i = 3; i + 3 < res.length; i += 4) {
    out.push(toUdsDtc(res[i], res[i + 1], res[i + 2], res[i + 3]));
  }
  return out;
}

/** 0x19 0x02 ReadDTCInformation / reportDTCByStatusMask. Default mask 0x09 = testFailed |
 *  confirmed (what a "stored faults" view wants); pass 0xFF for everything the module remembers. */
export async function readModuleDtcs(send: UdsSend, statusMask = 0x09): Promise<UdsDtc[]> {
  const res = checkNegative(0x19, await send('1902' + hex([statusMask])));
  return parseReportDtcByStatusMask(res);
}

/** 0x14 ClearDiagnosticInformation. Default group FFFFFF = all DTCs of the module. */
export async function clearModuleDtcs(send: UdsSend, groupHex = 'FFFFFF'): Promise<void> {
  checkNegative(0x14, await send('14' + groupHex));
}

/** 0x19 0x04 reportDTCSnapshotRecordByDTCNumber — the UDS "freeze frame" for one DTC. Returns the
 *  raw payload after [0x59, 0x04]; per-module DID layouts are not standardized, so the caller
 *  renders it as labelled hex (and may pick known DIDs out of it). */
export async function readDtcSnapshot(
  send: UdsSend,
  dtc: [number, number, number],
  record = 0xff,
): Promise<number[]> {
  const res = checkNegative(0x19, await send('1904' + hex([dtc[0], dtc[1], dtc[2], record])));
  return res.slice(2);
}

/** Standard UDS identification DIDs (ISO 14229 / used by VAG modules). */
export const MODULE_IDENT_DIDS: Record<string, string> = {
  F187: 'Part number',
  F189: 'Software version',
  F191: 'Hardware number',
  F197: 'System name',
  F18C: 'Serial number',
};

export interface ModuleIdent {
  partNumber?: string;
  softwareVersion?: string;
  hardwareNumber?: string;
  systemName?: string;
  serialNumber?: string;
  /** Raw decoded strings per DID, for the UI's raw view. */
  raw: Record<string, string>;
}

function asciiPrintable(data: number[]): string {
  return data
    .filter((b) => b >= 0x20 && b <= 0x7e)
    .map((b) => String.fromCharCode(b))
    .join('')
    .trim();
}

/** Read the standard ident DIDs, tolerantly — modules that lack a DID are skipped, not fatal.
 *  Sends `22 F1xx`; a module that answers none of them still returns an empty ident. */
export async function readModuleIdent(send: UdsSend): Promise<ModuleIdent> {
  const raw: Record<string, string> = {};
  for (const did of Object.keys(MODULE_IDENT_DIDS)) {
    try {
      const res = await send('22' + did);
      if (!res || res.length < 3 || res[0] !== 0x62) continue;
      const text = asciiPrintable(res.slice(3));
      if (text) raw[did] = text;
    } catch {
      // tolerated — ident is best-effort
    }
  }
  return {
    partNumber: raw['F187'],
    softwareVersion: raw['F189'],
    hardwareNumber: raw['F191'],
    systemName: raw['F197'],
    serialNumber: raw['F18C'],
    raw,
  };
}
