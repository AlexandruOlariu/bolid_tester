import { buildReplayExport, replayFileName, slugify } from './replayExport';
import type { LoggedIo } from '@/shared/obd-core';

const log: LoggedIo[] = [
  { dir: 'tx', text: 'ATZ' },
  { dir: 'rx', text: 'ELM327 v2.2\r\r' },
  { dir: 'tx', text: '03' },
  { dir: 'rx', text: '4301' }, // one line split across two BLE notifications
  { dir: 'rx', text: '2183\r\r' },
  { dir: 'tx', text: '04' },
  { dir: 'rx', text: '44\r\r' },
  { dir: 'tx', text: '03' },
  { dir: 'rx', text: '4300\r\r' },
];
const now = new Date('2026-11-09T10:20:30.456Z');

describe('replay fixture export', () => {
  it('carries pairs, sequences and a car meta block; the file name names vehicle + flow', () => {
    const { fileName, fixture } = buildReplayExport({
      log,
      flow: 'Clear',
      vehicleId: 'golf-plus-2009-20tdi',
      source: 'car',
      adapter: 'ELM327 v2.2',
      protocol: 'ISO_15765_4_CAN_11_500',
      appVersion: '0.2.0',
      now,
    });
    expect(fileName).toBe('bolid-replay-golf-plus-2009-20tdi-clear-2026-11-09T10-20-30-456Z.json');
    expect(fixture.pairs['03']).toBe('43012183');
    expect(fixture.sequences).toEqual({ '03': ['43012183', '4300'] });
    expect(fixture.meta).toEqual({
      source: 'car',
      vehicleId: 'golf-plus-2009-20tdi',
      flow: 'clear',
      adapter: 'ELM327 v2.2',
      protocol: 'ISO_15765_4_CAN_11_500',
      appVersion: '0.2.0',
    });
    expect(fixture.name).toBe('clear');
    expect(fixture.meta?.droppedEntries).toBeUndefined();
    expect(fixture.createdAt).toBe(now.getTime());
  });

  it('a log that wrapped is recorded as droppedEntries in meta', () => {
    const { fixture } = buildReplayExport({
      log,
      flow: 'live',
      vehicleId: 'golf-plus-2009-20tdi',
      source: 'car',
      droppedEntries: 42,
      appVersion: '0.2.0',
      now,
    });
    expect(fixture.meta?.droppedEntries).toBe(42);
  });

  it('a blank flow falls back to `session`; user ids and odd names are made file-safe', () => {
    const { fileName, fixture } = buildReplayExport({
      log,
      flow: '   ',
      vehicleId: 'user:abc',
      source: 'simulator',
      appVersion: '0.2.0',
      now,
    });
    expect(fixture.meta?.flow).toBe('session');
    expect(fixture.meta?.source).toBe('simulator');
    expect(fileName).toBe('bolid-replay-user-abc-session-2026-11-09T10-20-30-456Z.json');
    expect(slugify(' Module scan! ')).toBe('module-scan');
    expect(replayFileName('', 'x', now)).toBe(
      'bolid-replay-vehicle-x-2026-11-09T10-20-30-456Z.json',
    );
  });
});
