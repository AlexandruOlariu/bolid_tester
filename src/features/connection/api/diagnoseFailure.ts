/** Connection-failure classifier — pure, so every rule is unit-tested. The Connect screen's
 *  diagnostics panel (`ConnectionDiagnostics`) feeds it the session error, the phone's Bluetooth
 *  radio state and the tail of the adapter I/O log, and shows what happened and what to try.
 *  Rules are evaluated in order; the first match wins. See docs/features/connection.md. */

import type { BleLinkInfo } from '@/shared/transports/common/gatt';
import type { AdapterSource } from '@/shared/state/settingsStore';
import type { ConnectStage } from '@/shared/state/linkStore';
import { translate } from '@/shared/i18n';

export type { ConnectStage };

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

/** A `connection:diagnose.*` string in the UI language (plan 11). The classifier stays pure: it
 *  reads the shared i18next instance, English unless the app switched language. */
const tr = (key: string, vars?: Record<string, unknown>): string =>
  translate(`connection:diagnose.${key}`, vars);

/** One diagnosis from the `connection:diagnose.<id>` keys: `title`, `explanation` and the listed
 *  suggestion keys, in order. */
function diag(
  stage: ConnectStage,
  id: string,
  suggestions: string[],
  vars?: Record<string, unknown>,
): FailureDiagnosis {
  return {
    stage,
    title: tr(`${id}.title`, vars),
    explanation: tr(`${id}.explanation`, vars),
    suggestions: suggestions.map((s) => tr(`${id}.${s}`, vars)),
  };
}

/** The stage chip's label for `source`: the link stage of a Wi-Fi adapter is its Wi-Fi link, of a
 *  Classic Bluetooth adapter its classic Bluetooth link. */
export function stageLabel(stage: ConnectStage, source: AdapterSource): string {
  if (stage === 'transport' && source === 'wifi') return tr('stage.wifi');
  if (stage === 'transport' && source === 'spp') return tr('stage.spp');
  return tr(`stage.${stage}`);
}

/** Socket errors that mean the phone cannot reach the adapter's address at all: TcpTransport's
 *  own wrappers plus the errno names / texts Android and iOS socket errors carry (plan 26). */
const WIFI_UNREACHABLE =
  /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|Could not reach the Wi-Fi adapter|No answer from the Wi-Fi adapter|connection refused|no route to host|network is unreachable/i;

/** RFCOMM socket failures on Android ("read failed, socket might closed or timeout", "Connection
 *  refused", "Service discovery failed"): the adapter is paired, but its serial port did not open
 *  (plan 27). */
const SPP_UNREACHABLE = /socket|read failed|connection refused|service discovery failed/i;

const btPermission = () => diag('bluetooth', 'btPermission', ['s1', 's2']);

function bluetoothDiagnosis(state: Exclude<BtRadioState, 'ready' | 'checking'>): FailureDiagnosis {
  if (state === 'unauthorized') return btPermission();
  if (state === 'unsupported') return diag('bluetooth', 'bleUnsupported', ['s1', 's2']);
  return diag('bluetooth', 'btOff', ['s1', 's2']);
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
  const last = lastTx(input.logTail);
  const timeout = /timeout|timed out/i.test(error);
  const rxText = input.logTail
    .filter((e) => e.dir === 'rx')
    .map((e) => e.text.replace(/\s+/g, ''))
    .join('');
  const busInitFailed = /UNABLETOCONNECT|BUSINIT/i.test(rxText);

  if (input.adapterSource === 'ble' && input.btState !== 'ready' && input.btState !== 'checking') {
    return bluetoothDiagnosis(input.btState);
  }

  if (wifi && WIFI_UNREACHABLE.test(error)) {
    return diag('transport', 'wifiUnreachable', ['s1', 's2', 's3', 's4']);
  }

  if (spp && SPP_UNREACHABLE.test(error)) {
    return diag('transport', 'sppUnreachable', ['s1', 's2', 's3', 's4']);
  }

  if (/No suitable notify/i.test(error)) {
    return diag('transport', 'notBleSerial', ['s1', 's2', 's3']);
  }

  // `permisiun`: the Romanian permission text the scan hooks set (plan 11).
  if (!wifi && /permission|permisiun/i.test(error)) return btPermission();

  if (timeout && (last === 'ATZ' || /"ATZ"/.test(error))) {
    return diag('init', 'adapterSilent', [
      's1',
      's2',
      's3',
      wifi ? 's4wifi' : spp ? 's4spp' : 's4ble',
    ]);
  }

  if (/vehicle isn[’']t responding/i.test(error) && !busInitFailed) {
    return diag('probe', 'carSilent', ['s1', 's2', 's3']);
  }

  if (busInitFailed) {
    return diag('probe', 'busInit', ['s1', 's2', 's3', 's4']);
  }

  if (timeout && isObdCommand(last)) {
    return diag('identify', 'linkStalled', ['s1', 's2', 's3'], {
      link: tr(wifi ? 'stage.wifi' : 'stage.transport'),
    });
  }

  const explanationKey = !error
    ? input.deviceName
      ? 'unknownTo'
      : 'unknown'
    : input.deviceName
      ? 'errorTo'
      : 'error';
  return {
    stage: 'transport',
    title: tr('failed.title'),
    explanation: tr(`failed.${explanationKey}`, { device: input.deviceName ?? '', error }),
    suggestions: [
      tr('failed.s1'),
      tr('failed.s2'),
      tr(wifi ? 'failed.s3wifi' : 'failed.s3bt'),
      tr('failed.s4'),
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
