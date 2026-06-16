/** Pure, platform-agnostic core of the error log ("logging zone"): the record shape, normalising an
 *  unknown thrown value into a stable record, and rendering the saved errors for export. The zustand
 *  store and the screen build on top of this; keeping the logic here means it is unit-tested and
 *  lives under the lint/typecheck scope. See docs/features/error-log.md. */

export type ErrorSeverity = 'warning' | 'error' | 'fatal';

/** A value attached to an error for context — kept to JSON-friendly primitives so the whole record
 *  serialises cleanly to the persisted file and the export. */
export type ErrorContext = Record<string, string | number | boolean | null>;

/** A single saved error. `source` is a short tag for where it came from (e.g. 'connection', 'ai',
 *  'global') so exports can be grouped/scanned; `message`/`stack` come from `normalizeError`. */
export interface LoggedError {
  id: string;
  ts: number;
  severity: ErrorSeverity;
  source: string;
  message: string;
  stack?: string;
  context?: ErrorContext;
}

/** Input accepted by `logError` — everything except the auto-assigned `id`/`ts`, and the raw thrown
 *  value (`error`) instead of a pre-extracted message/stack. */
export interface LogErrorInput {
  source: string;
  /** The thrown value (Error, string, anything) — normalised internally. */
  error: unknown;
  severity?: ErrorSeverity;
  /** Optional human message to use instead of the one derived from `error`. */
  message?: string;
  context?: ErrorContext;
}

/** Pull a human message and a stack (when present) out of an arbitrary thrown value. */
export function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name || 'Error', stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  if (error == null) return { message: 'Unknown error' };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

/** Build a full record from caller input. `id`/`ts` are injected (defaulted here so it is testable). */
export function buildLoggedError(
  input: LogErrorInput,
  meta?: { id?: string; ts?: number },
): LoggedError {
  const { message, stack } = normalizeError(input.error);
  const rec: LoggedError = {
    id: meta?.id ?? newErrorId(),
    ts: meta?.ts ?? Date.now(),
    severity: input.severity ?? 'error',
    source: input.source,
    message: input.message ?? message,
  };
  if (stack) rec.stack = stack;
  if (input.context && Object.keys(input.context).length > 0) rec.context = input.context;
  return rec;
}

export function newErrorId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

/** Render the saved errors as a human-readable Markdown report for export/sharing. Newest-first is
 *  assumed (the store keeps them that way); this does not re-sort. */
export function formatErrorsForExport(errors: LoggedError[], opts?: { appVersion?: string }): string {
  const lines: string[] = [];
  lines.push('# Bolid Tester — error log');
  lines.push('');
  lines.push(`Exported: ${fmtTime(Date.now())}`);
  if (opts?.appVersion) lines.push(`App version: ${opts.appVersion}`);
  lines.push(`Errors: ${errors.length}`);
  lines.push('');

  if (errors.length === 0) {
    lines.push('_No errors logged._');
    return lines.join('\n');
  }

  for (const e of errors) {
    lines.push(`## [${e.severity.toUpperCase()}] ${e.source} — ${fmtTime(e.ts)}`);
    lines.push('');
    lines.push(e.message);
    if (e.context) {
      lines.push('');
      lines.push('Context:');
      for (const [k, v] of Object.entries(e.context)) lines.push(`- ${k}: ${String(v)}`);
    }
    if (e.stack) {
      lines.push('');
      lines.push('```');
      lines.push(e.stack);
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** Machine-readable export (one JSON document with the full records). */
export function errorsToJson(errors: LoggedError[]): string {
  return JSON.stringify({ exportedAt: Date.now(), count: errors.length, errors }, null, 2);
}
