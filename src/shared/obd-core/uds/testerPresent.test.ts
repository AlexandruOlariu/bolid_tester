import { testerPresentBurst } from './testerPresent';
import { UdsSend } from '../coding/udsCoding';

const noSleep = async () => {};

describe('testerPresentBurst', () => {
  it('sends the default 3 functional 3E00 frames', async () => {
    const seen: string[] = [];
    const send: UdsSend = async (cmd) => {
      seen.push(cmd);
      return [0x7e, 0x00];
    };
    const sent = await testerPresentBurst(send, { sleep: noSleep });
    expect(sent).toBe(3);
    expect(seen).toEqual(['3E00', '3E00', '3E00']);
  });

  it('honours a custom count', async () => {
    let n = 0;
    const send: UdsSend = async () => {
      n += 1;
      return null;
    };
    expect(await testerPresentBurst(send, { count: 5, sleep: noSleep })).toBe(5);
    expect(n).toBe(5);
  });

  it('never throws when the bus is asleep — swallows send errors and keeps going', async () => {
    let calls = 0;
    const send: UdsSend = async () => {
      calls += 1;
      throw new Error('No response'); // sleeping bus / timeout on the wake frame
    };
    const sent = await testerPresentBurst(send, { count: 3, sleep: noSleep });
    expect(calls).toBe(3); // kept sending despite each throwing
    expect(sent).toBe(0); // none dispatched cleanly, but no rejection
  });

  it('counts only the frames that dispatched without throwing', async () => {
    let calls = 0;
    const send: UdsSend = async () => {
      calls += 1;
      if (calls === 2) throw new Error('timeout');
      return null;
    };
    expect(await testerPresentBurst(send, { count: 3, sleep: noSleep })).toBe(2);
  });

  it('is a no-op for count 0', async () => {
    const send: UdsSend = async () => {
      throw new Error('should not be called');
    };
    expect(await testerPresentBurst(send, { count: 0, sleep: noSleep })).toBe(0);
  });
});
