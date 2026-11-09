/** Connection-failure classifier — pure, so every rule is unit-tested. The Connect screen's
 *  diagnostics panel (`ConnectionDiagnostics`) feeds it the session error, the phone's Bluetooth
 *  radio state and the tail of the adapter I/O log, and shows what happened and what to try.
 *  Rules are evaluated in order; the first match wins. See docs/features/connection.md. */

import type { BleLinkInfo } from '@/shared/transports/common/gatt';
import type { AdapterSource } from '@/shared/state/settingsStore';

/** Where a connect attempt failed: the phone's radio, the link (BLE or Wi-Fi), the adapter's own
 *  init, the first request to the car (`0100`), or reading the car's details afterwards. */
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
  adapterSource: AdapterSource;
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

/** The stage chip's label for `source`: the link stage of a Wi-Fi adapter is its Wi-Fi link, of a
 *  Classic Bluetooth adapter its classic Bluetooth link. */
export function stageLabel(stage: ConnectStage, source: AdapterSource): string {
  if (stage === 'transport' && source === 'wifi') return 'Wi-Fi link';
  if (stage === 'transport' && source === 'spp') return 'Classic Bluetooth link';
  return STAGE_LABELS[stage];
}

/** Socket errors that mean the phone cannot reach the adapter's address at all: TcpTransport's
 *  own wrappers plus the errno names / texts Android and iOS socket errors carry (plan 26). */
const WIFI_UNREACHABLE =
  /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|Could not reach the Wi-Fi adapter|No answer from the Wi-Fi adapter|connection refused|no route to host|network is unreachable/i;

const WIFI_UNREACHABLE_DIAGNOSIS: FailureDiagnosis = {
  stage: 'transport',
  title: 'Can’t reach the Wi-Fi adapter',
  explanation:
    'The phone is not on the adapter’s Wi-Fi network, or the adapter uses a different address.',
  suggestions: [
    'Join the adapter’s Wi-Fi network (usually “WiFi_OBDII”, no password). On Android, choose “Stay connected” if the phone warns the network has no internet.',
    'Check the adapter’s address: most use 192.168.0.10, port 35000 (Settings → Developer & simulator → Adapter source).',
    'Turn mobile data off, so the phone does not send the connection over the mobile network instead.',
    'On iPhone, allow Local Network for Bolid Tester (Settings → Privacy & Security → Local Network).',
  ],
};

/** RFCOMM socket failures on Android ("read failed, socket might closed or timeout", "Connection
 *  refused", "Service discovery failed"): the adapter is paired, but its serial port did not open
 *  (plan 27). */
const SPP_UNREACHABLE = /socket|read failed|connection refused|service discovery failed/i;

const SPP_UNREACHABLE_DIAGNOSIS: FailureDiagnosis = {
  stage: 'transport',
  title: 'Can’t open the Classic Bluetooth adapter',
  explanation: 'The adapter is paired but not reachable.',
  suggestions: [
    'Power-cycle the adapter: unplug it for 10 seconds, plug it back in, then reconnect.',
    'Make sure no other app (e.g. Torque) holds the connection — close it, or turn its auto-connect off.',
    'Keep the phone close to the adapter, with the ignition on.',
    'Still failing? Unpair the adapter in Android Settings → Bluetooth, pair it again (PIN 1234 or 0000), then refresh the list.',
  ],
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
        'Explore the app with the built-in simulator (Settings → Developer & simulator → Adapter source).',
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
  const wifi = input.adapterSource === 'wifi';
  const spp = input.adapterSource === 'spp';
  const linkName = wifi ? 'Wi-Fi link' : 'Bluetooth link';
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

  // 1b. Wi-Fi (plan 26): the socket never opened — wrong network or wrong address.
  if (wifi && WIFI_UNREACHABLE.test(error)) return WIFI_UNREACHABLE_DIAGNOSIS;

  // 1c. Classic Bluetooth (plan 27): paired, but the RFCOMM socket did not open.
  if (spp && SPP_UNREACHABLE.test(error)) return SPP_UNREACHABLE_DIAGNOSIS;

  // 2. Connected over BLE, but no serial-over-BLE characteristic pair (BleTransport's error).
  if (/No suitable notify/i.test(error)) {
    return {
      stage: 'transport',
      title: 'Not a Bluetooth LE serial adapter',
      explanation:
        'This device does not expose the serial-over-BLE characteristics an ELM327 uses — it may be ' +
        'a classic Bluetooth (SPP) adapter, which connects as a paired device instead.',
      suggestions: [
        'Check that you picked the OBD2 adapter, not another nearby device.',
        'A classic Bluetooth (“3.0”) adapter: on Android, pair it in the phone’s Bluetooth settings and choose Classic Bluetooth (Settings → Developer & simulator → Adapter source). iPhones cannot use classic adapters.',
        'Scan again and pick the adapter by name (Vlink, OBDII, VEEPEAK…).',
      ],
    };
  }

  // 3. Permission denied (the request in connectionService, or a scan).
  if (!wifi && /permission/i.test(error)) return BT_PERMISSION;

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
        wifi
          ? 'Still failing? Check the phone is still on the adapter’s Wi-Fi network.'
          : spp
            ? 'Still failing? Close any other OBD2 app that may hold the adapter, then reconnect.'
            : 'Still failing? Remove the adapter from the phone’s Bluetooth list and scan again.',
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
        `details — the ${linkName} or the adapter stalled.`,
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
      wifi
        ? 'Rejoin the adapter’s Wi-Fi network, then reconnect.'
        : 'Turn Bluetooth off and on again, then reconnect.',
      'Open the error log for the technical details.',
    ],
  };
}

const SOURCE_LABELS: Record<AdapterSource, string> = {
  ble: 'Bluetooth adapter',
  wifi: 'Wi-Fi adapter',
  spp: 'Classic Bluetooth adapter',
  mock: 'Simulator',
};

export interface DiagnosticsReportInput {
  diagnosis: FailureDiagnosis;
  error: string | null;
  logTail: { dir: 'tx' | 'rx'; text: string }[];
  link: BleLinkInfo | null;
  /** Furthest stage the connect attempt reached (linkStore), if known. */
  reached: ConnectStage | null;
  deviceId: string | null;
  deviceName: string | null;
  adapterSource: AdapterSource;
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
    `Stage: ${stageLabel(r.diagnosis.stage, r.adapterSource)} (${r.diagnosis.stage})`,
    `What happened: ${r.diagnosis.title}. ${r.diagnosis.explanation}`,
    'Try:',
    ...r.diagnosis.suggestions.map((s) => `- ${s}`),
    '',
    `Error: ${r.error ?? '(none)'}`,
    `Adapter source: ${SOURCE_LABELS[r.adapterSource]}`,
    `Device: ${r.deviceName ?? '(unknown)'} [${r.deviceId ?? '-'}]`,
  ];
  if (r.reached) lines.push(`Got as far as: ${stageLabel(r.reached, r.adapterSource)}`);
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
