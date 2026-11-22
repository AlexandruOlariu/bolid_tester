/** Sniffer run lifecycle (plan 03 review): Start clears the previous capture and freezes the header
 *  context; export is refused while running or empty; dispose (screen unmount / session change)
 *  stops ATMA and marks the run finished — also when it lands while start() is still setting ATMA
 *  up. vehicleStore persists through expo-file-system (ESM, not transformed for node), so the file
 *  system is mocked. */
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  cacheDirectory: null,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));

import { DiagnosticSession, formatCaptureCsv } from '@/shared/obd-core';
import { APP_VERSION } from '@/shared/lib/appInfo';
import { MockTransport } from '@/shared/obd-core/transport/MockTransport';
import { buildScenario } from '@/shared/obd-core/transport/scenarios';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { useSnifferStore } from './snifferStore';
import { snifferCapture } from './captureSession';
import { SnifferController, finishedCapture, type SnifferSession } from './snifferController';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A session whose ATMA setup (ATH1 round trip) only completes when the test says so. */
function gatedSession() {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let listener: ((line: string) => void) | null = null;
  const fake = {
    sniffing: false,
    startSniffer: jest.fn(async (onLine: (line: string) => void) => {
      await gate;
      listener = onLine;
      fake.sniffing = true;
    }),
    stopSniffer: jest.fn(async () => {
      listener = null;
      fake.sniffing = false;
    }),
  };
  return { fake, session: fake as SnifferSession, open, emit: (l: string) => listener?.(l) };
}

beforeEach(() => {
  useSnifferStore.setState({ running: false, note: '', capturedLines: 0, dropped: 0 });
  snifferCapture.buffer.clear();
  snifferCapture.startedAt = 0;
  snifferCapture.context = null;
  useSessionStore.getState().reset();
  useVehicleStore.setState({ selectedProfileId: 'generic' });
});

describe('SnifferController against the simulator', () => {
  it('Start clears the previous capture; the header keeps the car, adapter and note from Start', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    const info = await session.connect();
    useSessionStore.getState().setConnected(session, info, { id: 'dev-1', name: 'IOS-Vlink' });
    useVehicleStore.setState({ selectedProfileId: 'golf-plus-2009-20tdi' });
    useSnifferStore.getState().setNote('VCDS Group 121');
    snifferCapture.buffer.push('7E8 06 41 0C 1A F8', 1); // left over from an earlier run

    const c = new SnifferController(session);
    await c.start();
    expect(useSnifferStore.getState().running).toBe(true);
    expect(snifferCapture.buffer.lines().some((l) => l.t === 1)).toBe(false);
    await wait(150);
    expect(snifferCapture.buffer.size).toBeGreaterThan(0);
    expect(finishedCapture()).toBeNull(); // refused while running, even with lines captured
    await c.stop();
    expect(session.sniffing).toBe(false);
    expect(useSnifferStore.getState().running).toBe(false);
    expect(useSnifferStore.getState().capturedLines).toBe(snifferCapture.buffer.size);

    // Everything the header describes changes between Stop and Share.
    useVehicleStore.setState({ selectedProfileId: 'generic' });
    useSessionStore.getState().reset();
    useSnifferStore.getState().setNote('edited after stop');

    const capture = finishedCapture();
    expect(capture).not.toBeNull();
    expect(capture!.header).toMatchObject({
      vehicleId: 'golf-plus-2009-20tdi',
      protocol: info.protocol,
      note: 'VCDS Group 121',
    });
    expect(capture!.header.adapter).toContain('(IOS-Vlink)');
    const csv = formatCaptureCsv(capture!.header, capture!.lines);
    expect(csv).toContain('# note: VCDS Group 121');
    // The build that made the file is recorded (plan 04: wired once plan 08 gave APP_VERSION).
    expect(capture!.header.appVersion).toBe(APP_VERSION);
    expect(csv).toContain(`# app: ${APP_VERSION}`);
    expect(capture!.lines.length).toBeGreaterThan(0);
  });

  it('dispose while running stops ATMA and marks the run finished; the capture stays shareable', async () => {
    const session = new DiagnosticSession(new MockTransport(buildScenario('golf-plus-2009-20tdi')));
    await session.connect();
    const c = new SnifferController(session);
    await c.start();
    await wait(100);
    c.dispose();
    expect(useSnifferStore.getState().running).toBe(false);
    await wait(200); // stopMonitor waits ~120 ms for the prompt
    expect(session.sniffing).toBe(false);
    expect(finishedCapture()).not.toBeNull();
    expect(await session.readValue('010C')).not.toBeNull(); // channel released
  });
});

describe('SnifferController guards', () => {
  it('export is refused when nothing was captured', async () => {
    const { session, open } = gatedSession();
    open();
    const c = new SnifferController(session);
    await c.start();
    await c.stop();
    expect(snifferCapture.buffer.size).toBe(0);
    expect(finishedCapture()).toBeNull();
  });

  it('dispose during ATMA setup: the run ends, and the monitor is stopped once setup returns', async () => {
    const { fake, session, open, emit } = gatedSession();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const c = new SnifferController(session);
    const started = c.start();
    expect(useSnifferStore.getState().running).toBe(true);

    c.dispose(); // screen unmounted mid-ATH1: no monitor yet
    expect(fake.stopSniffer).not.toHaveBeenCalled();
    expect(useSnifferStore.getState().running).toBe(false);

    open();
    await started;
    expect(fake.stopSniffer).toHaveBeenCalledTimes(1);
    expect(fake.sniffing).toBe(false);
    expect(setIntervalSpy).not.toHaveBeenCalled(); // no orphaned snapshot timer
    emit('7E8 06 41 0C 1A F8');
    expect(snifferCapture.buffer.size).toBe(0);
    setIntervalSpy.mockRestore();

    // A new screen can start again.
    const next = gatedSession();
    next.open();
    const c2 = new SnifferController(next.session);
    await c2.start();
    expect(next.fake.startSniffer).toHaveBeenCalled();
    expect(useSnifferStore.getState().running).toBe(true);
    c2.dispose();
  });

  it('Stop during ATMA setup waits for it, then stops — no live monitor or timer is left', async () => {
    const { fake, session, open } = gatedSession();
    const c = new SnifferController(session);
    const started = c.start();
    const stopped = c.stop();
    open();
    await Promise.all([started, stopped]);
    expect(fake.stopSniffer).toHaveBeenCalledTimes(1);
    expect(fake.sniffing).toBe(false);
    expect(useSnifferStore.getState().running).toBe(false);
  });

  it('a second Start while running is ignored', async () => {
    const { fake, session, open } = gatedSession();
    open();
    const c = new SnifferController(session);
    await c.start();
    await c.start();
    expect(fake.startSniffer).toHaveBeenCalledTimes(1);
    c.dispose();
  });
});
