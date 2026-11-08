/** Connection-failure classifier — pure, so every rule is unit-tested. The Connect screen's
 *  diagnostics panel (`ConnectionDiagnostics`) feeds it the session error, the phone's Bluetooth
 *  radio state and the tail of the adapter I/O log, and shows what happened and what to try.
 *  Rules are evaluated in order; the first match wins. See docs/features/connection.md. */

import type { BleLinkInfo } from '@/shared/transports/ble/BleTransport';

/** Where a connect attempt failed: the phone's radio, the BLE link, the adapter's own init, the
 *  first request to the car (`0100`), or reading the car's details afterwards. */
export type ConnectStage = 'bluetooth' | 'transport' | 'init' | 'probe' | 'identify';

export type BtRadioState = 'ready' | 'poweredOff' | 'unauthorized' | 'unsupported' | 'checking';

export interface FailureDiagnosis {
  stage: ConnectStage;
  title: string;
  explanation: string;
  /** Ordered, imperative, at most 4. */
  suggestions: string[];
}

export interface DiagnoseInput {
  error: string | null;
  btState: BtRadioState;
  adapterSource: 'mock' | 'ble';
  /** The last ≤ 20 adapter-log entries of this attempt (oldest first). */
  logTail: { dir: 'tx' | 'rx'; text: string }[];
  deviceName: string | null;
}

/** Human labels for the stage chip. */
export const STAGE_LABELS: Record<ConnectStage, string> = {
  bluetooth: 'Phone Bluetooth',
  transport: 'Bluetooth link',
  init: 'Adapter start-up',
  probe: 'Car not answering',
  identify: 'Reading car details',
};

const BT_PERMISSION: FailureDiagnosis = {
  stage: 'bluetooth',
  title: 'Bluetooth permission needed',
  explanation: 'Bolid Tester is not allowed to use Bluetooth, so it cannot reach the adapter.',
  suggestions: [
    'Open system settings and allow “Nearby devices” (Android) or Bluetooth (iOS) for Bolid Tester.',
    'Come back here and connect again.',
  ],
};

function bluetoothDiagnosis(state: Exclude<BtRadioState, 'ready' | 'checking'>): FailureDiagnosis {
  if (state === 'unauthorized') return BT_PERMISSION;
  if (state === 'unsupported') {
    return {
      stage: 'bluetooth',
      title: 'Bluetooth LE not available',
      explanation:
        'This device doesn’t support Bluetooth Low Energy, so a wireless OBD2 adapter can’t be used.',
      suggestions: [
        'Use a phone or tablet with Bluetooth Low Energy.',
        'Explore the app with the built-in simulator (Settings → Adapter source).',
      ],
    };
  }
  return {
    stage: 'bluetooth',
    title: 'Bluetooth is off',
    explanation: 'The phone’s Bluetooth radio is off, so the app can’t reach the adapter.',
    suggestions: [
      'Turn Bluetooth on (Quick Settings on Android, Control Center on iOS).',
      'Scan for the adapter again once it is on.',
    ],
  };
}

/** The most recent non-empty command sent (a bare-CR wake-up logs as an empty tx and is skipped). */
function lastTx(logTail: DiagnoseInput['logTail']): string | null {
  for (let i = logTail.length - 1; i >= 0; i--) {
    const e = logTail[i];
    if (e.dir === 'tx' && e.text.trim()) return e.text.replace(/\s+/g, '').toUpperCase();
  }
  return null;
}

const isObdCommand = (cmd: string | null) => cmd !== null && /^[0-9A-F]{2,}$/.test(cmd);

export function diagnoseFailure(input: DiagnoseInput): FailureDiagnosis {
  const error = input.error ?? '';
  const last = lastTx(input.logTail);
  const timeout = /timeout|timed out/i.test(error);
  // On BLE each rx log entry is one GATT notification (≤ 20 bytes at MTU 23), so the adapter's
  // message can be split across entries ("SEARCHING...UNABLE" + "TO CONNECT"). Match against all
  // rx text joined with whitespace removed, so the split point never matters.
  const rxText = input.logTail
    .filter((e) => e.dir === 'rx')
    .map((e) => e.text.replace(/\s+/g, ''))
    .join('');
  const busInitFailed = /UNABLETOCONNECT|BUSINIT/i.test(rxText);

  // 1. The phone's radio (only meaningful for the real adapter; "checking" is not evidence).
  if (input.adapterSource === 'ble' && input.btState !== 'ready' && input.btState !== 'checking') {
    return bluetoothDiagnosis(input.btState);
  }

  // 2. Connected over BLE, but no serial-over-BLE characteristic pair (BleTransport's error).
  if (/No suitable notify/i.test(error)) {
    return {
      stage: 'transport',
      title: 'Not a Bluetooth LE serial adapter',
      explanation:
        'This device does not expose the serial-over-BLE characteristics an ELM327 uses — it may be ' +
        'a classic Bluetooth (SPP) adapter, which the app cannot use yet.',
      suggestions: [
        'Check that you picked the OBD2 adapter, not another nearby device.',
        'Check the adapter is a Bluetooth LE (“4.0”) model — a classic Bluetooth (“3.0”) one is not supported yet.',
        'Scan again and pick the adapter by name (Vlink, OBDII, VEEPEAK…).',
      ],
    };
  }

  // 3. Permission denied (the request in connectionService, or a scan).
  if (/permission/i.test(error)) return BT_PERMISSION;

  // 4. The link came up but the adapter never answered its reset.
  if (timeout && (last === 'ATZ' || /"ATZ"/.test(error))) {
    return {
      stage: 'init',
      title: 'Adapter not answering',
      explanation:
        'The adapter accepted the link but did not answer `ATZ` — it is unpowered or asleep.',
      suggestions: [
        'Check the adapter is pushed fully into the OBD2 port and its light is on.',
        'Wake it: unplug the adapter for 10 seconds, plug it back in, then reconnect.',
        'Move the phone closer to the adapter.',
        'Still failing? Remove the adapter from the phone’s Bluetooth list and scan again.',
      ],
    };
  }

  // 5. The adapter works, but the car's ECU did not answer 0100 (DiagnosticSession's wording).
  //    A failed bus start-up also ends in this error, so the more specific rule 6 wins then.
  if (/vehicle isn[’']t responding/i.test(error) && !busInitFailed) {
    return {
      stage: 'probe',
      title: 'The car is not answering',
      explanation:
        'The adapter is working, but the car’s engine computer did not answer the first OBD2 ' +
        'request (“0100”). This almost always means the ignition is off.',
      suggestions: [
        'Turn the ignition to ON — engine running is most reliable.',
        'Check the adapter is fully seated in the OBD2 port.',
        'Reconnect.',
      ],
    };
  }

  // 6. The adapter could not start a session on the bus (typical of K-line cars).
  if (busInitFailed) {
    return {
      stage: 'probe',
      title: 'Could not start the diagnostic bus',
      explanation:
        'The adapter could not open a session on the car’s bus (“UNABLE TO CONNECT” / “BUS INIT”). ' +
        'Older cars use the slow K-line bus, which needs the ignition on and a few seconds to start.',
      suggestions: [
        'Turn the ignition to ON and wait 5 seconds before connecting.',
        'Reconnect — a K-line start-up often succeeds on the second try.',
        'Check the adapter is fully seated in the OBD2 port.',
        'Check the car has OBD2 / EOBD (EU: petrol from 2001, diesel from 2004).',
      ],
    };
  }

  // 7. The car answered, then a later request (protocol, VIN, PID bitmaps) timed out.
  if (timeout && isObdCommand(last)) {
    return {
      stage: 'identify',
      title: 'The link stopped answering',
      explanation:
        'The car answered at first, but a request timed out while the app was reading the car’s ' +
        'details — the Bluetooth link or the adapter stalled.',
      suggestions: [
        'Reconnect.',
        'Move the phone closer to the adapter.',
        'If it keeps happening, unplug the adapter for 10 seconds and plug it back in.',
      ],
    };
  }

  // 8. Anything else: report the raw error against the link.
  const where = input.deviceName ? ` to ${input.deviceName}` : '';
  return {
    stage: 'transport',
    title: 'Connection failed',
    explanation: error
      ? `The connection${where} failed: ${error}`
      : `The connection${where} failed for an unknown reason.`,
    suggestions: [
      'Check the adapter is plugged in and its light is on.',
      'Move the phone closer to the adapter.',
      'Turn Bluetooth off and on again, then reconnect.',
      'Open the error log for the technical details.',
    ],
  };
}

export interface DiagnosticsReportInput {
  diagnosis: FailureDiagnosis;
  error: string | null;
  logTail: { dir: 'tx' | 'rx'; text: string }[];
  link: BleLinkInfo | null;
  /** Furthest stage the connect attempt reached (linkStore), if known. */
  reached: ConnectStage | null;
  deviceId: string | null;
  deviceName: string | null;
  adapterSource: 'mock' | 'ble';
}

/** One adapter-log line as Settings shows it: `» tx` / `« rx`, on one line (rx chunks keep their
 *  CR line breaks in the log; see obd-core `logRxText`). */
export function formatLogLine(e: { dir: 'tx' | 'rx'; text: string }): string {
  const text = e.text.replace(/\s+/g, ' ').trim();
  return `${e.dir === 'tx' ? '»' : '«'} ${text === '' ? '(wake-up)' : text}`;
}

/** Plain-text report for **Copy details** (shared via the OS share sheet). */
export function formatDiagnosticsReport(r: DiagnosticsReportInput): string {
  const lines = [
    'Bolid Tester — connection diagnostics',
    `Stage: ${STAGE_LABELS[r.diagnosis.stage]} (${r.diagnosis.stage})`,
    `What happened: ${r.diagnosis.title}. ${r.diagnosis.explanation}`,
    'Try:',
    ...r.diagnosis.suggestions.map((s) => `- ${s}`),
    '',
    `Error: ${r.error ?? '(none)'}`,
    `Adapter source: ${r.adapterSource === 'ble' ? 'Bluetooth adapter' : 'Simulator'}`,
    `Device: ${r.deviceName ?? '(unknown)'} [${r.deviceId ?? '-'}]`,
  ];
  if (r.reached) lines.push(`Got as far as: ${STAGE_LABELS[r.reached]}`);
  if (r.link) {
    lines.push(
      `Link: MTU ${r.link.mtu} (payload ${r.link.payload} B), service ${r.link.service}, ` +
        `write ${r.link.writeCharacteristic} ${r.link.writeWithoutResponse ? 'without response' : 'with response'}, ` +
        `notify ${r.link.notifyCharacteristic}`,
    );
  }
  lines.push('', `Adapter log (last ${r.logTail.length}):`, ...r.logTail.map(formatLogLine));
  return lines.join('\n');
}
