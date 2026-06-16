import {
  normalizeError,
  buildLoggedError,
  formatErrorsForExport,
  errorsToJson,
  type LoggedError,
} from './errorLog';

describe('errorLog core', () => {
  describe('normalizeError', () => {
    it('extracts message and stack from an Error', () => {
      const err = new Error('boom');
      const out = normalizeError(err);
      expect(out.message).toBe('boom');
      expect(out.stack).toContain('boom');
    });

    it('falls back to the name for an empty Error message', () => {
      expect(normalizeError(new TypeError('')).message).toBe('TypeError');
    });

    it('passes a string through unchanged with no stack', () => {
      expect(normalizeError('plain failure')).toEqual({ message: 'plain failure' });
    });

    it('handles null / undefined', () => {
      expect(normalizeError(null).message).toBe('Unknown error');
      expect(normalizeError(undefined).message).toBe('Unknown error');
    });

    it('JSON-stringifies an object value', () => {
      expect(normalizeError({ code: 42 }).message).toBe('{"code":42}');
    });
  });

  describe('buildLoggedError', () => {
    it('defaults severity to error and assigns id/ts', () => {
      const rec = buildLoggedError({ source: 'connection', error: new Error('nope') }, { id: 'x', ts: 1000 });
      expect(rec).toMatchObject({ id: 'x', ts: 1000, severity: 'error', source: 'connection', message: 'nope' });
      expect(rec.stack).toBeDefined();
    });

    it('prefers an explicit message and keeps non-empty context', () => {
      const rec = buildLoggedError(
        { source: 'ai', error: 'raw', message: 'friendly', severity: 'warning', context: { url: 'http://x' } },
        { id: 'y', ts: 2000 },
      );
      expect(rec.message).toBe('friendly');
      expect(rec.severity).toBe('warning');
      expect(rec.context).toEqual({ url: 'http://x' });
    });

    it('omits empty context', () => {
      const rec = buildLoggedError({ source: 's', error: 'e', context: {} }, { id: 'z', ts: 1 });
      expect('context' in rec).toBe(false);
    });

    it('generates a unique id when none is supplied', () => {
      const a = buildLoggedError({ source: 's', error: 'e' });
      const b = buildLoggedError({ source: 's', error: 'e' });
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('formatErrorsForExport', () => {
    const sample: LoggedError[] = [
      {
        id: '1',
        ts: 0,
        severity: 'error',
        source: 'connection',
        message: 'Bluetooth permission denied',
        stack: 'Error: Bluetooth permission denied\n  at connect',
        context: { adapterSource: 'ble' },
      },
    ];

    it('reports an empty log', () => {
      expect(formatErrorsForExport([])).toContain('No errors logged');
    });

    it('renders header, message, context and stack', () => {
      const out = formatErrorsForExport(sample, { appVersion: '0.1.0' });
      expect(out).toContain('# Bolid Tester — error log');
      expect(out).toContain('App version: 0.1.0');
      expect(out).toContain('Errors: 1');
      expect(out).toContain('[ERROR] connection');
      expect(out).toContain('Bluetooth permission denied');
      expect(out).toContain('- adapterSource: ble');
      expect(out).toContain('at connect');
    });
  });

  describe('errorsToJson', () => {
    it('round-trips the records', () => {
      const errors: LoggedError[] = [{ id: '1', ts: 5, severity: 'fatal', source: 'global', message: 'x' }];
      const parsed = JSON.parse(errorsToJson(errors));
      expect(parsed.count).toBe(1);
      expect(parsed.errors[0]).toMatchObject({ id: '1', severity: 'fatal', source: 'global', message: 'x' });
    });
  });
});
