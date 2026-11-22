import { computePollPids, enabledRulePids, planSweep } from './pollPids';
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
    expect(computePollPids({ registrations: {}, alertPids: ['0105'], tripPids: [] })).toEqual([
      '0105',
    ]);
  });

  it('polls the trip PID set while recording even with no screen or alerts', () => {
    expect(
      computePollPids({ registrations: {}, alertPids: [], tripPids: ['010C', '010D'] }),
    ).toEqual(['010C', '010D']);
  });
});

describe('mixed Mode 01 / extended keys', () => {
  it('computePollPids keeps extended keys in the union, de-duplicated', () => {
    const keys = computePollPids({
      registrations: { chart: ['22:1701', '010C'], extended: ['22:1701', '22:1702'] },
      alertPids: ['22:1706', '010C'],
      tripPids: ['010C', '010D'],
    });
    expect(keys).toEqual(['22:1701', '010C', '22:1702', '22:1706', '010D']);
  });

  it('planSweep splits the union and keeps only declared DIDs on CAN', () => {
    expect(planSweep(['22:1701', '010C', '22:9999', '010C'], ['1701', '1702'], true)).toEqual({
      pids: ['010C'],
      dids: ['1701'],
    });
  });

  it('planSweep drops every DID off CAN or for a profile without DIDs (stale chart panel)', () => {
    expect(planSweep(['22:1701', '010C'], ['1701'], false)).toEqual({ pids: ['010C'], dids: [] });
    expect(planSweep(['22:1701', '010C'], [], true)).toEqual({ pids: ['010C'], dids: [] });
  });
});
