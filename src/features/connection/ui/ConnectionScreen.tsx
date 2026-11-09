import React, { useState } from 'react';
import { Platform } from 'react-native';
import { YStack, XStack, Button, Paragraph, Spinner, Text, Card, Input } from 'tamagui';
import { CheckCircle2, XCircle, Loader, CircleDashed } from 'lucide-react-native';
import { Screen, SectionTitle, usePalette, type Tone, HIT_SLOP } from '@/shared/ui';
import { FirstRunCard } from '@/features/onboarding';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import type { ConnState } from '@/shared/state/sessionStore';
import { useScan } from '../hooks/useScan';
import { useConnect } from '../hooks/useConnect';
import { formatEndpoint } from '@/shared/transports/tcp/endpoint';
import { switchAdapterSource, switchToRealAdapter } from '../api/connectionService';
import { useBluetoothState } from '../hooks/useBluetoothState';
import { DeviceRow } from './DeviceRow';
import { BluetoothPrompt } from './BluetoothPrompt';
import { ConnectionDiagnostics } from './ConnectionDiagnostics';
import { SppConnect } from './SppConnect';
import { WebBluetoothConnect } from './WebBluetoothConnect';
import { Panel } from '../styles/connection.styles';

const STATUS_CONFIG: Record<ConnState, { icon: React.ElementType; tone: Tone; label: string }> = {
  disconnected: { icon: CircleDashed, tone: 'muted', label: 'Disconnected' },
  connecting: { icon: Loader, tone: 'statusWarn', label: 'Connecting…' },
  initializing: { icon: Loader, tone: 'statusWarn', label: 'Initializing…' },
  connected: { icon: CheckCircle2, tone: 'accent', label: 'Connected' },
  error: { icon: XCircle, tone: 'statusError', label: 'Error' },
};

/** The connection state. A polite live region (plan 20): TalkBack / VoiceOver announce
 *  "Connecting…", "Connected" or "Error" as it changes, without the user moving focus. */
function StatusHero({ status }: { status: ConnState }) {
  const cfg = STATUS_CONFIG[status];
  const colour = usePalette()[cfg.tone];
  const Icon = cfg.icon;
  return (
    <Card
      bordered
      padding="$4"
      borderColor={colour}
      borderWidth={1.5}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`OBD2 adapter: ${cfg.label}`}
      accessibilityLiveRegion="polite"
      testID="connection-status"
    >
      <XStack alignItems="center" gap="$3">
        <Icon size={32} color={colour} />
        <YStack>
          <SectionTitle color={colour}>{cfg.label}</SectionTitle>
          <Text fontSize="$2" color="$placeholderColor">
            OBD2 adapter
          </Text>
        </YStack>
      </XStack>
    </Card>
  );
}

const SUBTITLES = {
  ble: 'Pair with your OBD2 Bluetooth adapter',
  wifi: 'Connect to your Wi-Fi OBD2 adapter',
  spp: 'Connect to your paired classic Bluetooth adapter',
  mock: 'Pair with your OBD2 Bluetooth adapter',
} as const;

/** The Wi-Fi adapter branch (plan 26): join the adapter's network, then connect to the endpoint
 *  from Settings. There is nothing to scan and no permission to ask for. */
function WifiConnect({ busy, onConnect }: { busy: boolean; onConnect: () => void }) {
  const wifi = useSettingsStore((s) => s.wifi);
  return (
    <YStack gap="$3" marginTop="$2" testID="connect-wifi">
      <Panel>
        <YStack gap="$2">
          <Text fontWeight="700" fontSize="$3">
            Wi-Fi adapter
          </Text>
          <Paragraph fontSize="$3">
            Join the adapter’s Wi-Fi network first (usually{' '}
            <Text fontWeight="700" color="$color">
              WiFi_OBDII
            </Text>
            , no password). On Android, if the phone warns the network has no internet, choose{' '}
            <Text fontStyle="italic" color="$color">
              Stay connected
            </Text>
            .
          </Paragraph>
          <Paragraph theme="alt2" fontSize="$2">
            Adapter address:{' '}
            <Text fontWeight="700" color="$color" testID="connect-wifi-endpoint">
              {formatEndpoint(wifi)}
            </Text>{' '}
            — change it in Settings → Developer & simulator → Adapter source.
          </Paragraph>
        </YStack>
      </Panel>
      <Button
        theme="green"
        size="$5"
        disabled={busy}
        icon={busy ? () => <Spinner /> : undefined}
        onPress={onConnect}
      >
        Connect over Wi-Fi
      </Button>
      <Button size="$5" disabled={busy} onPress={() => void switchAdapterSource('ble')}>
        Use a Bluetooth adapter
      </Button>
    </YStack>
  );
}

export function ConnectionScreen() {
  const adapterSource = useSettingsStore((s) => s.adapterSource);
  // Set once when a stored Classic Bluetooth source was replaced on iOS (plan 27).
  const sourceNotice = useSettingsStore((s) => s.adapterSourceNotice);
  const dismissSourceNotice = useSettingsStore((s) => s.dismissAdapterSourceNotice);
  const simulated = useSettingsStore((s) => s.simulatedVehicleId);
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const { scanning, devices, start, stop } = useScan();
  const { connect, chooseAndConnect, busy } = useConnect();
  // In the browser, Bluetooth LE goes through Web Bluetooth and the browser's own chooser (plan 28).
  const web = Platform.OS === 'web';
  // Only the native Bluetooth LE source touches the BLE stack: the simulator, Wi-Fi, Classic
  // Bluetooth and the web build never construct a BleManager (plans 26, 27, 28).
  const bt = useBluetoothState(adapterSource === 'ble' && !web);
  const [manualId, setManualId] = useState('');

  // Positively-known "not ready" states block scanning; while still settling we let the scan run and
  // rely on useScan's own guard, so a slow/unknown adapter state can't wedge the button forever.
  const btBlocked = bt.poweredOff || bt.unauthorized || bt.unsupported;

  return (
    <Screen title="Connect" subtitle={SUBTITLES[adapterSource]}>
      <StatusHero status={status} />

      <FirstRunCard />

      {sourceNotice ? (
        <Panel testID="adapter-source-notice">
          <Paragraph fontSize="$3">{sourceNotice}</Paragraph>
          <Button size="$3" hitSlop={HIT_SLOP} alignSelf="flex-start" onPress={dismissSourceNotice}>
            OK
          </Button>
        </Panel>
      ) : null}

      {error ? (
        <Panel backgroundColor="$red2">
          <Paragraph color="$statusError">{error}</Paragraph>
        </Panel>
      ) : null}

      {/* What failed and what to try — renders only while the session is in `error`. */}
      <ConnectionDiagnostics bt={bt} />

      {adapterSource === 'mock' ? (
        <YStack gap="$3" marginTop="$2">
          <Panel>
            <Paragraph fontSize="$3">
              Simulator mode is on — readings are not from a real car.{'\n'}Emulating:{' '}
              <Text fontWeight="700" color="$color">
                {simulated}
              </Text>
            </Paragraph>
          </Panel>
          <Button
            theme="green"
            size="$5"
            disabled={busy}
            icon={busy ? () => <Spinner /> : undefined}
            onPress={() => connect()}
          >
            Connect to simulator
          </Button>
          <Button size="$5" disabled={busy} onPress={() => void switchToRealAdapter()}>
            Use a real adapter
          </Button>
        </YStack>
      ) : adapterSource === 'wifi' ? (
        <WifiConnect busy={busy} onConnect={() => void connect()} />
      ) : adapterSource === 'spp' ? (
        <SppConnect busy={busy} onConnect={(target) => void connect(target)} />
      ) : web ? (
        <WebBluetoothConnect busy={busy} onChoose={() => void chooseAndConnect()} />
      ) : (
        <YStack gap="$3" marginTop="$2">
          <BluetoothPrompt bt={bt} />

          <Button
            theme="blue"
            size="$5"
            disabled={btBlocked && !scanning}
            onPress={scanning ? stop : start}
            icon={scanning ? () => <Spinner /> : undefined}
          >
            {scanning ? 'Scanning…' : 'Scan for adapters'}
          </Button>
          <YStack gap="$2">
            {devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                disabled={busy}
                onConnect={() => connect({ deviceId: d.id, deviceName: d.name ?? undefined })}
              />
            ))}
            {!scanning && devices.length === 0 ? (
              <Paragraph theme="alt2" fontSize="$3">
                {Platform.OS === 'android'
                  ? 'No devices yet. Plug in the adapter, switch the ignition on, then scan. If the ' +
                    'adapter is already paired in Android’s Bluetooth settings it may have stopped ' +
                    'advertising — “Forget” it there first, or connect by address below.'
                  : 'No devices yet. Plug in the adapter, switch the ignition on, then scan.'}
              </Paragraph>
            ) : null}
            {/* iOS exposes CoreBluetooth UUIDs, not MAC addresses, so there is no connect-by-address
                panel; a Bluetooth LE adapter is never paired in iOS Settings (plan 09). */}
            {Platform.OS === 'ios' ? (
              <Paragraph theme="alt2" fontSize="$2" testID="ios-scan-hint">
                If the adapter is not listed, turn it off and on; iOS does not pair OBD2 BLE
                adapters in Settings.
              </Paragraph>
            ) : null}
          </YStack>

          {Platform.OS === 'android' ? (
            <Panel>
              <YStack gap="$2">
                <Text fontWeight="700" fontSize="$3">
                  Connect by address
                </Text>
                <Paragraph theme="alt2" fontSize="$2">
                  If the adapter never shows up in the scan, copy its Bluetooth MAC (from Android
                  Settings → Bluetooth) and connect directly.
                </Paragraph>
                <XStack gap="$2" alignItems="center">
                  <Input
                    flex={1}
                    value={manualId}
                    onChangeText={setManualId}
                    placeholder="AA:BB:CC:DD:EE:FF"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel="Adapter Bluetooth MAC address"
                  />
                  <Button
                    theme="green"
                    disabled={busy || manualId.trim().length === 0}
                    onPress={() => connect({ deviceId: manualId.trim().toUpperCase() })}
                  >
                    Connect
                  </Button>
                </XStack>
              </YStack>
            </Panel>
          ) : null}

          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            chromeless
            alignSelf="flex-start"
            disabled={busy}
            onPress={() => void switchAdapterSource('wifi')}
          >
            Using a Wi-Fi adapter instead?
          </Button>
          {/* Classic Bluetooth (SPP) is Android only: iOS needs MFi, which ELM327 clones lack. */}
          {Platform.OS === 'android' ? (
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              chromeless
              alignSelf="flex-start"
              disabled={busy}
              onPress={() => void switchAdapterSource('spp')}
            >
              Using a classic Bluetooth (3.0) adapter instead?
            </Button>
          ) : null}
        </YStack>
      )}
    </Screen>
  );
}
