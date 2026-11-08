import {
  diagnoseFailure,
  formatDiagnosticsReport,
  formatLogLine,
  type DiagnoseInput,
} from './diagnoseFailure';

const base: DiagnoseInput = {
  error: null,
  btState: 'ready',
  adapterSource: 'ble',
  logTail: [],
  deviceName: 'IOS-Vlink',
};

const tx = (text: string) => ({ dir: 'tx' as const, text });
const rx = (text: string) => ({ dir: 'rx' as const, text });

const IGNITION_ERROR =
  'Connected to the adapter, but the vehicle isn’t responding (no reply to OBD2 “0100”). Turn the ' +
  'ignition to ON — engine running is most reliable — and make sure the adapter is fully seated in ' +
  'the OBD2 port, then reconnect.';

describe('diagnoseFailure', () => {
  it('bluetooth: the radio is off / unauthorized / unsupported (real adapter only)', () => {
    expect(diagnoseFailure({ ...base, btState: 'poweredOff', error: 'x' })).toMatchObject({
      stage: 'bluetooth',
      title: 'Bluetooth is off',
    });
    expect(diagnoseFailure({ ...base, btState: 'unauthorized' }).title).toBe(
      'Bluetooth permission needed',
    );
    expect(diagnoseFailure({ ...base, btState: 'unsupported' }).title).toBe(
      'Bluetooth LE not available',
    );
    // The simulator never needs the radio; a still-settling radio is not evidence either.
    expect(
      diagnoseFailure({ ...base, adapterSource: 'mock', btState: 'poweredOff' }).stage,
    ).not.toBe('bluetooth');
    expect(diagnoseFailure({ ...base, btState: 'checking' }).stage).toBe('transport');
  });

  it('transport: no notify + write characteristic (likely a classic SPP adapter)', () => {
    const d = diagnoseFailure({
      ...base,
      error: 'No suitable notify + write characteristics found on this device',
    });
    expect(d.stage).toBe('transport');
    expect(d.explanation).toMatch(/classic Bluetooth \(SPP\)/);
  });

  it('bluetooth: a permission error', () => {
    const d = diagnoseFailure({ ...base, error: 'Bluetooth permission denied' });
    expect(d).toMatchObject({ stage: 'bluetooth', title: 'Bluetooth permission needed' });
  });

  it('init: the last command was ATZ and it timed out (unpowered or asleep)', () => {
    const d = diagnoseFailure({
      ...base,
      error: 'ELM327 timeout after 5000ms for "ATZ"',
      logTail: [tx('ATI'), tx('ATZ')],
    });
    expect(d.stage).toBe('init');
    expect(d.explanation).toMatch(/unpowered or asleep/);
    // A bare-CR wake-up after ATZ (an empty tx) does not hide it.
    expect(
      diagnoseFailure({
        ...base,
        error: 'ELM327 timeout after 5000ms',
        logTail: [tx('ATZ'), tx('')],
      }).stage,
    ).toBe('init');
  });

  it('probe: the vehicle is not responding → ignition guidance', () => {
    const d = diagnoseFailure({
      ...base,
      error: IGNITION_ERROR,
      logTail: [tx('ATSP0'), rx('OK'), tx('0100'), rx('NO DATA')],
    });
    expect(d.stage).toBe('probe');
    expect(d.suggestions[0]).toMatch(/ignition to ON/);
  });

  it('probe: UNABLE TO CONNECT / BUS INIT in the log → K-line guidance', () => {
    for (const reply of ['UNABLE TO CONNECT', 'BUS INIT: ...ERROR']) {
      const d = diagnoseFailure({
        ...base,
        error: IGNITION_ERROR,
        logTail: [tx('0100'), rx(reply)],
      });
      expect(d.stage).toBe('probe');
      expect(d.title).toBe('Could not start the diagnostic bus');
      expect(d.explanation).toMatch(/K-line/);
    }
  });

  it('probe: an UNABLE TO CONNECT split across two BLE notifications still matches', () => {
    // withLog writes one rx entry per GATT notification (≤ 20 bytes at MTU 23), trimmed.
    for (const split of [
      ['SEARCHING... UNABLE', 'TO CONNECT'],
      ['SEARCHING... UNA', 'BLE TO CONNECT'],
      ['BUS IN', 'IT: ...ERROR'],
    ]) {
      const d = diagnoseFailure({
        ...base,
        error: IGNITION_ERROR,
        logTail: [tx('0100'), rx(split[0]), rx(split[1])],
      });
      expect(d.title).toBe('Could not start the diagnostic bus');
    }
  });

  it('identify: a later OBD request timed out', () => {
    const d = diagnoseFailure({
      ...base,
      error: 'ELM327 timeout after 5000ms for "0902"',
      logTail: [tx('0100'), rx('41 00 BE 3E B8 11'), tx('ATDPN'), rx('A6'), tx('0902')],
    });
    expect(d.stage).toBe('identify');
  });

  it('falls back to transport with the raw error', () => {
    const d = diagnoseFailure({ ...base, error: 'Device AA:BB was disconnected' });
    expect(d.stage).toBe('transport');
    expect(d.explanation).toContain('Device AA:BB was disconnected');
    expect(d.explanation).toContain('IOS-Vlink');
    expect(diagnoseFailure({ ...base, deviceName: null }).explanation).toMatch(/unknown reason/);
    // A timeout with no command in the log is a link problem, not an identify one.
    expect(diagnoseFailure({ ...base, error: 'Operation timed out' }).stage).toBe('transport');
  });

  it('never suggests more than four things', () => {
    const inputs: DiagnoseInput[] = [
      { ...base, btState: 'poweredOff' },
      { ...base, error: 'No suitable notify + write characteristics' },
      { ...base, error: 'ELM327 timeout after 5000ms for "ATZ"', logTail: [tx('ATZ')] },
      { ...base, error: IGNITION_ERROR },
      { ...base, logTail: [rx('BUS INIT: ERROR')] },
      { ...base, error: 'boom' },
    ];
    for (const i of inputs) {
      const d = diagnoseFailure(i);
      expect(d.suggestions.length).toBeGreaterThan(0);
      expect(d.suggestions.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('formatDiagnosticsReport', () => {
  it('includes the diagnosis, the link, the device and the log tail', () => {
    const logTail = [tx('ATZ'), tx('')];
    const diagnosis = diagnoseFailure({
      ...base,
      error: 'ELM327 timeout after 5000ms for "ATZ"',
      logTail,
    });
    const text = formatDiagnosticsReport({
      diagnosis,
      error: 'ELM327 timeout after 5000ms for "ATZ"',
      logTail,
      link: {
        mtu: 23,
        payload: 20,
        service: 'fff0',
        notifyCharacteristic: 'fff1',
        writeCharacteristic: 'fff2',
        writeWithoutResponse: true,
      },
      reached: 'init',
      deviceId: 'AA:BB',
      deviceName: 'IOS-Vlink',
      adapterSource: 'ble',
    });
    expect(text).toContain('Stage: Adapter start-up (init)');
    expect(text).toContain('MTU 23 (payload 20 B)');
    expect(text).toContain('IOS-Vlink [AA:BB]');
    expect(text).toContain('» ATZ');
    expect(text).toContain('» (wake-up)');
    expect(text).toContain('Got as far as: Adapter start-up');
    expect(formatLogLine(rx('OK'))).toBe('« OK');
  });
});
