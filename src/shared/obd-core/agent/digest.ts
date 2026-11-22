/** Formatting helpers for the compact text digests the AI diagnostic agent's tools return to the
 *  model (plan 34a): a length clamp (~400 tokens), a one-line min / avg / max summary of a sampled
 *  value and its trend (plan 34b). See docs/features/ai-diagnose.md. */

/** A tool digest's length cap: about 400 tokens. */
export const MAX_DIGEST_CHARS = 1600;

const TRUNCATED = '\n… (truncated)';

export interface ClampOptions {
  /** End a cut digest with `… (N more)`, N being the lines left out, instead of `… (truncated)`:
   *  for line-per-item digests (modules, codes, errors), so the model knows how much it missed. */
  countMore?: boolean;
}

/** The first lines of `text` that fit in `max` together with a `… (N more)` line counting the
 *  rest, or null when not even the first line fits. */
function clampCountingMore(text: string, max: number): string | null {
  const lines = text.split('\n');
  // headLength + trailer never shrinks as `keep` grows (each kept line adds ≥ 1 character, the
  // count loses at most one digit), so the first `keep` that does not fit ends the search.
  let keep = 0;
  let headLength = -1;
  while (keep + 1 < lines.length) {
    const nextHead = headLength + lines[keep].length + 1;
    if (nextHead + `\n… (${lines.length - keep - 1} more)`.length > max) break;
    headLength = nextHead;
    keep++;
  }
  if (keep === 0) return null;
  return `${lines.slice(0, keep).join('\n')}\n… (${lines.length - keep} more)`;
}

/** `text` cut to at most `max` characters: at the last line break that fits, followed by a
 *  `… (truncated)` line, or with `countMore` a `… (N more)` line. A single line longer than the
 *  room is cut mid-line. */
export function clampDigest(text: string, max = MAX_DIGEST_CHARS, opts: ClampOptions = {}): string {
  if (text.length <= max) return text;
  if (opts.countMore) {
    const counted = clampCountingMore(text, max);
    if (counted !== null) return counted;
  }
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

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/** Whether a sampled value went up, down or stayed put over the window: the mean of the last third
 *  minus the mean of the first third, `steady` when that change is under 1 or 5 % of the overall
 *  mean, whichever is larger. Fewer than two values read as `steady`. */
export function trendOf(values: number[]): 'rising' | 'falling' | 'steady' {
  if (values.length < 2) return 'steady';
  const third = Math.max(1, Math.floor(values.length / 3));
  const delta = mean(values.slice(-third)) - mean(values.slice(0, third));
  if (Math.abs(delta) < Math.max(1, 0.05 * Math.abs(mean(values)))) return 'steady';
  return delta > 0 ? 'rising' : 'falling';
}
