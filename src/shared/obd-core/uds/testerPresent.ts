/** Bus wake / functional TesterPresent broadcast. VW modules on a parked car let the bus fall
 *  asleep; the first physically-addressed request of a scan then times out ("probe fails on a
 *  parked car"). A short functional TesterPresent burst (0x3E 0x00 to the OBD2 functional address)
 *  nudges the bus awake before the scan. Pure over an injectable `UdsSend` — the caller points it at
 *  the functional header. See docs/features/module-scan.md (bus wake). */

import { UdsSend } from '../coding/udsCoding';

export interface TesterPresentBurstOptions {
  /** How many 0x3E00 frames to send. Default 3. */
  count?: number;
  /** Delay between frames in ms. Default 150 (3 frames ≈ 300 ms + I/O — bounded to ~1 s). */
  gapMs?: number;
  /** Injectable sleep so tests run instantly; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Best-effort functional TesterPresent (0x3E 0x00) burst to wake a sleeping VW bus before a scan.
 *  Sends `count` frames through `send` (the caller sets the functional address), **ignoring every
 *  response and swallowing every error** — a still-asleep bus, a clone that NAKs, or a timeout must
 *  never abort the scan that follows. Returns how many frames were dispatched without throwing. */
export async function testerPresentBurst(
  send: UdsSend,
  opts: TesterPresentBurstOptions = {},
): Promise<number> {
  const count = Math.max(0, Math.floor(opts.count ?? 3));
  const gapMs = opts.gapMs ?? 150;
  const sleep = opts.sleep ?? realSleep;
  let sent = 0;
  for (let i = 0; i < count; i++) {
    try {
      await send('3E00');
      sent += 1;
    } catch {
      // best-effort: a sleeping bus / NAK / timeout on the wake frame is expected and ignored.
    }
    if (i < count - 1 && gapMs > 0) await sleep(gapMs);
  }
  return sent;
}
