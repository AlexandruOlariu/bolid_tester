/** Formatting helpers for the compact text digests the AI diagnostic agent's tools return to the
 *  model (plan 34a): a length clamp (~400 tokens) and a one-line min / avg / max summary of a
 *  sampled value. See docs/features/ai-diagnose.md. */

/** A tool digest's length cap: about 400 tokens. */
export const MAX_DIGEST_CHARS = 1600;

const TRUNCATED = '\n… (truncated)';

/** `text` cut to at most `max` characters: at the last line break that fits, followed by a
 *  `… (truncated)` line. A single line longer than the room is cut mid-line. */
export function clampDigest(text: string, max = MAX_DIGEST_CHARS): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - TRUNCATED.length);
  const nl = text.lastIndexOf('\n', room);
  const cut = nl > 0 ? text.slice(0, nl) : text.slice(0, room);
  return cut + TRUNCATED;
}

/** A number with at most one decimal (`98`, `100.3`). */
export function oneDecimal(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** `"<name>: min 98 / avg 100 / max 102 kPa (n=20, 10 s)"` over `values` sampled for `seconds`. */
export function statsLine(name: string, unit: string, values: number[], seconds: number): string {
  const window = `(n=${values.length}, ${seconds} s)`;
  if (values.length === 0) return `${name}: no answer ${window}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const u = unit ? ` ${unit}` : '';
  return `${name}: min ${oneDecimal(min)} / avg ${oneDecimal(avg)} / max ${oneDecimal(max)}${u} ${window}`;
}
