import { computePollPids, enabledRulePids } from './pollPids';
import type { AlertRule } from '@/shared/obd-core';

const rule = (id: string, pid: string, enabled?: boolean): AlertRule => ({
  id,
  pid,
  op: 'gt',
  value: 1,
  severity: 'warn',
  enabled,
});

describe('enabledRulePids', () => {
  it('collects PIDs of enabled rules only, de-duplicated', () => {
    const rules = [rule('a', '0105'), rule('b', '0105'), rule('c', '010C', false)];
    expect(enabledRulePids(rules)).toEqual(['0105']);
  });

  it('treats an undefined enabled flag as enabled', () => {
    expect(enabledRulePids([rule('a', '0142')])).toEqual(['0142']);
  });
});

describe('computePollPids', () => {
  it('unions screen registrations, alert PIDs and (while recording) trip PIDs, de-duplicated', () => {
    const pids = computePollPids({
      registrations: { screenA: ['010C', '010D'], screenB: ['010C', '0105'] },
      alertPids: ['0105', '0142'],
      tripPids: ['010D', '0111'],
    });
    expect(pids).toEqual(['010C', '010D', '0105', '0142', '0111']);
  });

  it('is empty when nothing is registered, no alerts reference PIDs, and not recording', () => {
    expect(computePollPids({ registrations: {}, alertPids: [], tripPids: [] })).toEqual([]);
  });

  it('still polls alert PIDs with no screen mounted (alerts run app-wide)', () => {
    expect(computePollPids({ registrations: {}, alertPids: ['0105'], tripPids: [] })).toEqual(['0105']);
  });

  it('polls the trip PID set while recording even with no screen or alerts', () => {
    expect(
      computePollPids({ registrations: {}, alertPids: [], tripPids: ['010C', '010D'] }),
    ).toEqual(['010C', '010D']);
  });
});
