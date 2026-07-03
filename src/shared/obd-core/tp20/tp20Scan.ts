/** TP2.0 scan: open a channel to the gateway, read its installation list, then per pre-UDS module
 *  start a diagnostic session, read ident (KWP 0x1A) and faults (KWP 0x18). Pure over a RawCanLink
 *  — unit-tested against FakeTp20Bus and a golden real-car byte trace, runs on hardware via
 *  Elm327RawCanLink. See docs/features/tp20.md. */

import { KwpDtc, RawCanLink, Tp20Channel, parseGatewayInstallList, parseKwpDtcs } from './tp20';
import { vagModuleName } from './vagModules';

export const GATEWAY_ADDRESS = 0x19;

export interface Tp20ModuleResult {
  address: number;
  name: string;
  /** 'ok' ident read; 'refused' channel opened but the module rejected the ident read (KWP 0x7F);
   *  'silent' no channel / no reply; 'not-installed' absent from the gateway list. */
  state: 'ok' | 'silent' | 'refused' | 'not-installed';
  ident?: string;
  /** KWP 0x18 faults (VAG 5-digit codes). Present when the fault read got a positive answer —
   *  an empty array means "no faults stored". */
  dtcs?: KwpDtc[];
  reason?: string;
}

export interface Tp20ScanResult {
  installed: number[];
  modules: Tp20ModuleResult[];
  /** Set when the gateway channel / install-list read failed; the scan still details the `wanted`
   *  modules directly so one bad gateway doesn't blank the whole result. */
  gatewayError?: string;
}

const ascii = (bytes: number[]) =>
  bytes
    .filter((b) => b >= 0x20 && b <= 0x7e)
    .map((b) => String.fromCharCode(b))
    .join('')
    .trim();

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

/** Detail one module over its own channel: best-effort session start (0x10 0x89 — some modules
 *  want it before answering), ident (0x1A 0x9B), faults (0x18 0x02 FF 00). */
async function probeModule(
  link: RawCanLink,
  address: number,
  timeoutMs: number,
): Promise<Omit<Tp20ModuleResult, 'address' | 'name'>> {
  const ch = new Tp20Channel(link, { timeoutMs });
  try {
    try {
      await ch.open(address);
    } catch (e) {
      return { state: 'silent', reason: `No TP2.0 channel: ${msg(e)}` };
    }
    try {
      await ch.request([0x10, 0x89]); // startDiagnosticSession; refusal (0x7F) is fine
    } catch {
      // best-effort — a module that opened a channel but won't talk shows up below anyway
    }

    let ident: string | undefined;
    let refused: number | undefined;
    try {
      const r = await ch.request([0x1a, 0x9b]);
      if (r[0] === 0x5a) ident = ascii(r.slice(2));
      else if (r[0] === 0x7f) refused = r[2];
    } catch (e) {
      return { state: 'silent', reason: `No ident reply: ${msg(e)}` };
    }

    let dtcs: KwpDtc[] | undefined;
    try {
      const r = await ch.request([0x18, 0x02, 0xff, 0x00]); // readDTCByStatus, all groups
      dtcs = parseKwpDtcs(r) ?? undefined;
    } catch {
      // fault read is optional — ident alone is still a useful result
    }

    if (ident !== undefined) return { state: 'ok', ident, dtcs };
    return {
      state: 'refused',
      dtcs,
      reason: `Ident refused (KWP NRC 0x${hex(refused ?? 0)}).`,
    };
  } finally {
    await ch.close();
  }
}

/** Full TP2.0 scan. `wanted` restricts which addresses to detail (e.g. the profile's tp20 modules);
 *  when omitted, every installed address is detailed. */
export async function scanTp20(
  link: RawCanLink,
  opts: { wanted?: number[]; timeoutMs?: number } = {},
): Promise<Tp20ScanResult> {
  const timeoutMs = opts.timeoutMs ?? 1000;
  const gw = new Tp20Channel(link, { timeoutMs });
  let installed: number[] = [];
  let gatewayError: string | undefined;
  try {
    await gw.open(GATEWAY_ADDRESS);
    const resp = await gw.request([0x21, 0x0b]);
    installed = parseGatewayInstallList(resp);
    if (!installed.length) {
      gatewayError = 'Gateway answered but the installation list was empty / unrecognised.';
    }
  } catch (e) {
    gatewayError = `Gateway install-list read failed: ${msg(e)}`;
  } finally {
    await gw.close();
  }

  const targets = opts.wanted ?? installed;
  const modules: Tp20ModuleResult[] = [];
  for (const address of targets) {
    if (installed.length && !installed.includes(address)) {
      modules.push({ address, name: vagModuleName(address), state: 'not-installed' });
      continue;
    }
    const detail = await probeModule(link, address, timeoutMs);
    modules.push({ address, name: vagModuleName(address), ...detail });
  }
  return { installed, modules, gatewayError };
}
