/** Redaction for command text that leaves the bus: the adapter I/O log, replay fixtures and error
 *  messages. A VAG KWP2000 login (`2B` + code + workshop code, plan 22) carries the owner's module
 *  login code in plain hex, so its text is replaced before it is logged or put in an error. Pure. */

/** A KWP login request: `2B` followed only by hex digits (spaces allowed). */
const KWP_LOGIN = /^\s*2B[\s0-9A-F]+$/i;

/** What a KWP login request reads as in the log. */
export const REDACTED_LOGIN = '2B <login code redacted>';

/** `cmd` with a KWP login's code and workshop code removed; any other command unchanged.
 *  `redactCommand('2B3039000000')` -> `'2B <login code redacted>'`; `'0100'` -> `'0100'`. */
export function redactCommand(cmd: string): string {
  return KWP_LOGIN.test(cmd) ? REDACTED_LOGIN : cmd;
}
