import {
  startOutputControl,
  stopOutputControl,
  startGuidedRoutine,
  stopGuidedRoutine,
  guidedRoutineResults,
} from './guidedRoutine';
import { UdsError, UdsSend } from '../coding/udsCoding';
import { DiagnosticSession } from '../session/DiagnosticSession';
import { MockTransport } from '../transport/MockTransport';
import { buildScenario } from '../transport/scenarios';

describe('guidedRoutine primitives', () => {
  const log: string[] = [];
  const echoSend: UdsSend = async (cmd) => {
    log.push(cmd);
    const c = cmd.toUpperCase();
    if (c.startsWith('10')) return [0x50, 0x03];
    if (c.startsWith('2F')) return [0x6f, 0x01, 0x30, parseInt(c.slice(6, 8), 16)];
    if (c.startsWith('31'))
      return [0x71, ...c.slice(2).match(/../g)!.map((h) => parseInt(h, 16))];
    return null;
  };

  it('starts and stops an output control (2F)', async () => {
    log.length = 0;
    await startOutputControl(echoSend, '0130', [0x40]);
    expect(log).toContain('2F01300340');
    await stopOutputControl(echoSend, '0130');
    expect(log).toContain('2F013000');
  });

  it('start/stop/results for a 31 routine, entering the session first', async () => {
    log.length = 0;
    await startGuidedRoutine(echoSend, { service: '31', id: '0201' });
    expect(log[0]).toBe('1003');
    expect(log[1]).toBe('31010201');
    const results = await guidedRoutineResults(echoSend, { service: '31', id: '0201' });
    expect(results).toEqual([]);
    await stopGuidedRoutine(echoSend, { service: '31', id: '0201' });
    expect(log).toContain('31020201');
  });

  it('runs SecurityAccess before the routine when a seedToKey is supplied', async () => {
    const seen: string[] = [];
    const send: UdsSend = async (cmd) => {
      const c = cmd.toUpperCase();
      seen.push(c);
      if (c.startsWith('10')) return [0x50, 0x03];
      if (c === '2703') return [0x67, 0x03, 0x11, 0x22]; // seed
      if (c.startsWith('2704')) return [0x67, 0x04]; // key accepted
      if (c.startsWith('31')) return [0x71, ...c.slice(2).match(/../g)!.map((h) => parseInt(h, 16))];
      return null;
    };
    await startGuidedRoutine(send, {
      service: '31',
      id: '0301',
      security: { level: 0x03, seedToKey: (s) => s.map((b) => b ^ 0xff) },
    });
    expect(seen[0]).toBe('1003');
    expect(seen[1]).toBe('2703'); // requestSeed
    expect(seen[2]).toBe('2704EEDD'); // sendKey = seed XOR 0xFF
    expect(seen[3]).toBe('31010301'); // routine only after unlock
  });

  it('skips SecurityAccess when only a level is declared (no algorithm)', async () => {
    const seen: string[] = [];
    const send: UdsSend = async (cmd) => {
      const c = cmd.toUpperCase();
      seen.push(c);
      if (c.startsWith('10')) return [0x50, 0x03];
      if (c.startsWith('31')) return [0x71, ...c.slice(2).match(/../g)!.map((h) => parseInt(h, 16))];
      return null;
    };
    await startGuidedRoutine(send, { service: '31', id: '0301', security: { level: 0x03 } });
    expect(seen).toEqual(['1003', '31010301']); // no 27xx sent
  });

  it('results are refused for 2F descriptors and stop never throws', async () => {
    await expect(guidedRoutineResults(echoSend, { service: '2F', id: '0130' })).rejects.toBeInstanceOf(
      UdsError,
    );
    const dead: UdsSend = async () => null;
    await expect(stopGuidedRoutine(dead, { service: '31', id: '0201' })).resolves.toBeUndefined();
  });

  it('runs against the simulated Golf end-to-end', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await session.connect();
    const send = (cmd: string) => session.send(cmd);
    await session.setHeader('7E0');
    await expect(startGuidedRoutine(send, { service: '31', id: '0201' })).resolves.toBeUndefined();
    await expect(startGuidedRoutine(send, { service: '2F', id: '0130', controlData: [0x40] })).resolves.toBeUndefined();
    await stopGuidedRoutine(send, { service: '2F', id: '0130' });
    await session.setHeader(null);
  });
});
