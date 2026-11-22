/** The error-log agent tool (plan 34b): `read_app_errors` lists the app's own logged errors newest
 *  first, scrubbed of identifiers, then counts them per source over the last 24 h. The persist
 *  storage runs over a no-op file system. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { buildAgentRegistry, parseSkillFile } from '@/shared/obd-core';
import type { AgentContribution, AgentTool, ReadOnlySession, ToolContext } from '@/shared/obd-core';
import { logError, useErrorLogStore } from '@/shared/state/errorLogStore';
import type { LoggedError } from '@/shared/lib/errorLog';
import { getVehicleProfile } from '@/shared/vehicles';
import en from '@/shared/i18n/locales/en/errorLog.json';
import ro from '@/shared/i18n/locales/ro/errorLog.json';
import { agentTools as errTools } from './agentTools';
import appErrorsSkill from './app_errors.skill.json';

const golf = getVehicleProfile('golf-plus-2009-20tdi');
const NOW = new Date(2026, 10, 20, 12, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

function ctxAt(now: () => number): ToolContext {
  return {
    session: {} as ReadOnlySession,
    profile: golf,
    guideProfileId: golf.id,
    vehicle: { label: golf.name, make: golf.make },
    vin: null,
    now,
    sleep: async () => undefined,
    signal: new AbortController().signal,
    askDriver: async () => ({ kind: 'done' }),
  };
}

const golfCtx = ctxAt(() => Date.now());
const fixedCtx = ctxAt(() => NOW);

function toolOf(c: AgentContribution, name: string): AgentTool {
  const t = c.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

let n = 0;
/** A saved error `agoMs` before NOW (store order: newest first). */
function err(agoMs: number, source: string, message: string, severity = 'error'): LoggedError {
  return { id: `e${n++}`, ts: NOW - agoMs, source, message, severity } as LoggedError;
}

beforeEach(() => {
  n = 0;
  useErrorLogStore.setState({ errors: [] });
  // logError mirrors every record to the console; keep the test output clean.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('read_app_errors', () => {
  it('app errors are scrubbed', async () => {
    logError({
      source: 'ble',
      error: new Error('lost WVWZZZ1KZ9W903398 at http://192.168.0.10:35000'),
    });
    const d = (await toolOf(errTools, 'read_app_errors').run({}, golfCtx)).digest;
    expect(d).not.toContain('WVWZZZ1KZ9W903398');
    expect(d).not.toContain('192.168.0.10');
  });

  it('is empty-safe', async () =>
    expect((await toolOf(errTools, 'read_app_errors').run({}, fixedCtx)).digest).toBe(
      'No app errors logged.',
    ));

  it('lists the newest errors with their age, then counts per source over 24 h', async () => {
    useErrorLogStore.setState({
      errors: [
        err(30_000, 'ble', 'GATT 133 at 192.168.0.10:35000'),
        err(5 * MIN, 'ai', `timeout ${'y'.repeat(200)}`, 'warning'),
        err(3 * HOUR, 'ble', 'lost link'),
        err(26 * HOUR, 'global', 'TypeError', 'fatal'),
      ],
    });
    const r = await toolOf(errTools, 'read_app_errors').run({}, fixedCtx);
    const lines = r.digest.split('\n');
    expect(lines[0]).toBe('4 app errors logged, newest first:');
    expect(lines[1]).toBe('30 s ago ble error: GATT 133 at <address>');
    expect(lines[2]).toMatch(/^5 min ago ai warning: timeout y+…$/);
    expect(lines[2].length).toBe('5 min ago ai warning: '.length + 120);
    expect(lines[3]).toBe('3 h ago ble error: lost link');
    expect(lines[4]).toBe('1 d ago global fatal: TypeError');
    expect(lines[5]).toBe('Last 24 h: ble 2, ai 1 (3 errors)');
    expect(r.summary).toBe('App errors: 3 in 24 h');
  });

  it('honours limit and counts the 24 h window over every error', async () => {
    useErrorLogStore.setState({
      errors: Array.from({ length: 12 }, (_, i) => err(i * MIN, 'obd', `e${i}`)),
    });
    const lines = (
      await toolOf(errTools, 'read_app_errors').run({ limit: 3 }, fixedCtx)
    ).digest.split('\n');
    expect(lines).toEqual([
      '12 app errors logged, newest first:',
      '0 s ago obd error: e0',
      '1 min ago obd error: e1',
      '2 min ago obd error: e2',
      '… (9 older errors)',
      'Last 24 h: obd 12 (12 errors)',
    ]);
  });

  it('says when nothing was logged in the last 24 h', async () => {
    useErrorLogStore.setState({ errors: [err(48 * HOUR, 'ai', 'old')] });
    const d = (await toolOf(errTools, 'read_app_errors').run({}, fixedCtx)).digest;
    expect(d.split('\n').pop()).toBe('Last 24 h: none');
  });
});

describe('error-log contribution', () => {
  it('declares the tool always offered and free of adapter time', () => {
    const t = toolOf(errTools, 'read_app_errors');
    expect(
      t.available({
        profile: getVehicleProfile('passat-b55-19tdi'),
        protocol: 'ISO_14230_4_KWP_FAST',
        supportedPids: [],
        canMonitor: false,
      }),
    ).toBe(true);
    expect(t.costMs).toBe(0);
    expect(t.labelKey).toBe('errorLog:agent.tool.read_app_errors');
    expect(t.args.properties.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 });
  });

  it('bundles an app_errors skill that parses and registers', () => {
    expect(parseSkillFile(appErrorsSkill).ok).toBe(true);
    expect(errTools.skills?.map((s) => s.name)).toEqual(['app_errors']);
    expect(errTools.skills?.[0].tools).toEqual(['read_app_errors']);
    expect(() => buildAgentRegistry([errTools])).not.toThrow();
  });

  it('the tool label has en and ro text', () => {
    for (const locale of [en, ro]) expect(locale.agent.tool.read_app_errors).toBeTruthy();
  });
});
