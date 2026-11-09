import React, { useMemo, useState } from 'react';
import { Platform, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { YStack, XStack, Button, Paragraph, Text, Card } from 'tamagui';
import { ChevronDown, ChevronRight, Stethoscope } from 'lucide-react-native';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useAdapterLogStore } from '@/shared/state/adapterLog';
import { logError } from '@/shared/state/errorLogStore';
import type { BluetoothState } from '../hooks/useBluetoothState';
import {
  diagnoseFailure,
  formatDiagnosticsReport,
  formatLogLine,
  stageLabel,
  type BtRadioState,
} from '../api/diagnoseFailure';
import { useLinkStore } from '../model/linkStore';
import { Panel } from '../styles/connection.styles';

const ACCENT = '#F85149'; // matches the error status color
const LOG_TAIL = 20;

function radioState(bt: BluetoothState): BtRadioState {
  if (bt.ready) return 'ready';
  if (bt.poweredOff) return 'poweredOff';
  if (bt.unauthorized) return 'unauthorized';
  if (bt.unsupported) return 'unsupported';
  return 'checking';
}

/** Shown under the error panel on the Connect screen whenever the session is in `error`: what went
 *  wrong (a stage + plain-English explanation), what to try, and — under a collapsible "Details" —
 *  this attempt's adapter-log tail, the negotiated BLE link (or the Wi-Fi socket) and the device, with **Copy details**
 *  (OS share sheet) and **Open error log**. The rules live in the pure `diagnoseFailure`. */
export function ConnectionDiagnostics({ bt }: { bt: BluetoothState }) {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const adapterSource = useSettingsStore((s) => s.adapterSource);
  const entries = useAdapterLogStore((s) => s.entries);
  const link = useLinkStore((s) => s.link);
  const kind = useLinkStore((s) => s.kind);
  const reached = useLinkStore((s) => s.stage);
  const since = useLinkStore((s) => s.attemptStartedAt);
  // The failed attempt's own target — sessionStore's device is only set on success (and keeps the
  // previous adapter after a drop), so it would name the wrong device here.
  const deviceId = useLinkStore((s) => s.device?.id ?? null);
  const deviceName = useLinkStore((s) => s.device?.name ?? null);
  const [open, setOpen] = useState(false);
  const monoFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

  // Only this attempt's traffic: an older session's commands would mislead the classifier.
  const logTail = useMemo(
    () => entries.filter((e) => since === null || e.ts >= since).slice(-LOG_TAIL),
    [entries, since],
  );
  const btState = radioState(bt);
  const diagnosis = useMemo(
    () => diagnoseFailure({ error, btState, adapterSource, logTail, deviceName }),
    [error, btState, adapterSource, logTail, deviceName],
  );

  if (status !== 'error') return null;

  const copy = async () => {
    const message = formatDiagnosticsReport({
      diagnosis,
      error,
      logTail,
      link,
      reached,
      deviceId,
      deviceName,
      adapterSource,
    });
    try {
      await Share.share({ message, title: 'Connection diagnostics' });
    } catch (e) {
      logError({ source: 'connection/diagnostics-share', error: e, severity: 'warning' });
    }
  };

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Panel borderColor={ACCENT} accessibilityLabel="Connection diagnostics">
      <XStack gap="$3" alignItems="flex-start">
        <Stethoscope size={22} color={ACCENT} />
        <YStack flex={1} gap="$2">
          <XStack>
            <Card
              paddingHorizontal="$2"
              paddingVertical="$1"
              backgroundColor="$red3"
              borderRadius="$10"
              accessibilityLabel={`Failed at: ${stageLabel(diagnosis.stage, adapterSource)}`}
            >
              <Text fontSize="$1" fontWeight="700" color="$red11">
                {stageLabel(diagnosis.stage, adapterSource)}
              </Text>
            </Card>
          </XStack>
          <Text fontWeight="800" fontSize="$4">
            {diagnosis.title}
          </Text>
          <Paragraph fontSize="$3">{diagnosis.explanation}</Paragraph>
          <YStack gap="$1">
            <Text fontWeight="700" fontSize="$3">
              What to try
            </Text>
            {diagnosis.suggestions.map((s, i) => (
              <Paragraph key={i} fontSize="$3">
                {'• '}
                {s}
              </Paragraph>
            ))}
          </YStack>

          <Button
            size="$2"
            chromeless
            alignSelf="flex-start"
            icon={<Chevron size={16} />}
            onPress={() => setOpen((v) => !v)}
            accessibilityLabel={open ? 'Hide connection details' : 'Show connection details'}
          >
            Details
          </Button>

          {open ? (
            <YStack gap="$2">
              <YStack gap="$1">
                <Text fontSize="$2" color="$placeholderColor">
                  Device: {deviceName ?? 'unknown'}
                  {deviceId ? ` (${deviceId})` : ''}
                </Text>
                {reached ? (
                  <Text fontSize="$2" color="$placeholderColor">
                    Got as far as: {stageLabel(reached, adapterSource)}
                  </Text>
                ) : null}
                {link ? (
                  <Text fontSize="$2" color="$placeholderColor">
                    Link: MTU {link.mtu} ({link.payload} bytes per write) · service {link.service} ·{' '}
                    {link.writeWithoutResponse ? 'write without response' : 'write with response'}
                  </Text>
                ) : null}
                {kind === 'wifi' ? (
                  <Text fontSize="$2" color="$placeholderColor">
                    Link: Wi-Fi (TCP socket){deviceId ? ` to ${deviceId}` : ''}
                  </Text>
                ) : null}
              </YStack>
              <Card bordered padding="$2" backgroundColor="$backgroundStrong">
                {logTail.length === 0 ? (
                  <Paragraph theme="alt2" fontSize="$2">
                    No adapter traffic in this attempt.
                  </Paragraph>
                ) : (
                  logTail.map((e, i) => (
                    <Text
                      key={i}
                      fontSize="$1"
                      fontFamily={monoFont}
                      color={e.dir === 'tx' ? '$blue10' : '$green10'}
                      numberOfLines={2}
                    >
                      {formatLogLine(e)}
                    </Text>
                  ))
                )}
              </Card>
              <XStack gap="$2" flexWrap="wrap">
                <Button size="$3" onPress={() => void copy()}>
                  Copy details
                </Button>
                <Button size="$3" onPress={() => router.push('/error-log')}>
                  Open error log
                </Button>
              </XStack>
            </YStack>
          ) : null}
        </YStack>
      </XStack>
    </Panel>
  );
}
