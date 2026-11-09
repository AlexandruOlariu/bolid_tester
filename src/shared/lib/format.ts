/** Locale-aware number and date formatting (plan 11, docs/i18n.md). Units stay metric and their
 *  symbols are never translated; only the digits, separators and date order follow the language
 *  (`12.5` in English, `12,5` in Romanian). The i18n module calls `setFormatLocale` whenever the
 *  language changes, so code outside React agrees with the UI. Pure — no i18next / React Native
 *  imports — so the core tests cover it. */

let formatLocale = 'en';

export function setFormatLocale(locale: string): void {
  formatLocale = locale || 'en';
}

export function getFormatLocale(): string {
  return formatLocale;
}

export interface NumberFormatOptions {
  /** Fewest fraction digits shown (default 0; equal to `maxFractionDigits` behaves like `toFixed`). */
  minFractionDigits?: number;
  /** Thousands separators (default off: live values read `1234 rpm`, not `1,234 rpm`). */
  grouping?: boolean;
  /** Override the current locale (tests). */
  locale?: string;
}

/** `value` in the current locale with at most `maxFractionDigits` decimals. Non-finite → `—`. */
export function formatNumber(
  value: number,
  maxFractionDigits = 1,
  options: NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) return '—';
  const max = Math.max(0, maxFractionDigits);
  const min = Math.min(max, Math.max(0, options.minFractionDigits ?? 0));
  try {
    return new Intl.NumberFormat(options.locale ?? formatLocale, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: options.grouping ?? false,
    }).format(value);
  } catch {
    return value.toFixed(max);
  }
}

/** Like `value.toFixed(digits)` but with the locale's decimal separator. */
export function formatFixed(value: number, digits: number, locale?: string): string {
  return formatNumber(value, digits, { minFractionDigits: digits, locale });
}

function dateFormat(ts: number, opts: Intl.DateTimeFormatOptions, locale?: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale ?? formatLocale, opts).format(d);
  } catch {
    return d.toISOString();
  }
}

/** A calendar date (`Nov 9, 2026` / `9 nov. 2026`). */
export function formatDate(ts: number, locale?: string): string {
  return dateFormat(ts, { year: 'numeric', month: 'short', day: 'numeric' }, locale);
}

/** A date and a time to the minute. */
export function formatDateTime(ts: number, locale?: string): string {
  return dateFormat(
    ts,
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    locale,
  );
}

/** A time of day; `seconds` adds the seconds (charts, trip track points). */
export function formatTime(ts: number, seconds = false, locale?: string): string {
  return dateFormat(
    ts,
    seconds
      ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' },
    locale,
  );
}
