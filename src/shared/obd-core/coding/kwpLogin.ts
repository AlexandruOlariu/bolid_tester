/** VAG KWP2000 login (plan 22) — the "Login – 11" step VCDS performs before a pre-UDS module
 *  accepts an adaptation write. Pure: runs over the injectable `UdsSend`, so it is unit-tested
 *  with a fake sender and runs unchanged over K-line (ISO 14230) or, later, a TP2.0 channel.
 *  The app ships **no login codes**: the code comes from the owner (code book) or from a profile
 *  that documents it from the owner's own VCDS history. See docs/features/adaptations.md. */

import {
  UdsError,
  checkNegative,
  describeUnlockFailure,
  hexBytes,
  type UdsSend,
} from './udsCoding';

/** Largest login code: two bytes on the wire. */
export const MAX_LOGIN_CODE = 0xffff;
/** Largest workshop code (WSC): five decimal digits (three bytes on the wire). */
export const MAX_WORKSHOP_CODE = 99999;

const isIntIn = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;

/** The `2B` request for `code` / `wsc`: `2B` + 2-byte big-endian code + 3-byte big-endian WSC. */
export function kwpLoginRequest(code: number, wsc = 0): string {
  if (!isIntIn(code, MAX_LOGIN_CODE)) throw new UdsError(`Login code out of range: ${code}`);
  if (!isIntIn(wsc, MAX_WORKSHOP_CODE)) throw new UdsError(`Workshop code out of range: ${wsc}`);
  const bytes = [
    (code >> 8) & 0xff,
    code & 0xff,
    (wsc >> 16) & 0xff,
    (wsc >> 8) & 0xff,
    wsc & 0xff,
  ];
  return '2B' + hexBytes(bytes).toUpperCase();
}

/** VAG KWP2000 login (VCDS "Login – 11"). `code` is the 5-digit number (0–65535); `wsc` the
 *  workshop code (0–99999, default 0). Positive response 0x6B. Throws UdsError on 7F 2B xx — NRC
 *  0x35 as "Login code rejected". */
export async function kwpLogin(send: UdsSend, code: number, wsc = 0): Promise<void> {
  const req = kwpLoginRequest(code, wsc);
  try {
    checkNegative(0x2b, await send(req));
  } catch (e) {
    if (e instanceof UdsError && e.nrc === 0x35) {
      throw new UdsError('Login code rejected (NRC 0x35)', 0x35);
    }
    throw e;
  }
}

/** Five-digit, zero-padded text for a login code, as VCDS shows it: 12345 -> '12345', 7 -> '00007'. */
export function formatLoginCode(code: number): string {
  return String(Math.max(0, Math.trunc(code))).padStart(5, '0');
}

/** Parse what the user typed: 1–5 digits (spaces ignored), within 0–65535; anything else -> null.
 *  '01234' -> 1234; 'abc' -> null; '65536' -> null. */
export function parseLoginCode(text: string): number | null {
  const t = text.replace(/\s+/g, '');
  if (!/^\d{1,5}$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_LOGIN_CODE ? n : null;
}

/** Parse an optional workshop code: empty -> 0; 1–5 digits -> the number; anything else -> null. */
export function parseWorkshopCode(text: string): number | null {
  const t = text.replace(/\s+/g, '');
  if (t === '') return 0;
  if (!/^\d{1,5}$/.test(t)) return null;
  return Number(t);
}

/** Plain-English text for a failed login / login-gated write, or null when the error is not a
 *  login or unlock refusal (the caller then shows its generic failure). */
export function describeLoginFailure(err: unknown): string | null {
  if (!(err instanceof UdsError)) return null;
  if (err.nrc === 0x35) {
    return 'Login code rejected — the module did not accept this code. Nothing was written.';
  }
  if (err.nrc === 0x33) {
    return (
      'The module refused the write without a valid login (NRC 0x33 security access denied). ' +
      'Nothing was written.'
    );
  }
  return describeUnlockFailure(err);
}
