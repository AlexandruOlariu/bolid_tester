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
import { Trans, useTranslation } from '@/shared/i18n';

const STATUS_CONFIG: Record<ConnState, { icon: React.ElementType; tone: Tone }> = {
  disconnected: { icon: CircleDashed, tone: 'muted' },
  connecting: { icon: Loader, tone: 'statusWarn' },
  initializing: { icon: Loader, tone: 'statusWarn' },
  connected: { icon: CheckCircle2, tone: 'accent' },
  error: { icon: XCircle, tone: 'statusError' },
};

/** The connection state. A polite live region (plan 20): TalkBack / VoiceOver announce
 *  "Connecting…", "Connected" or "Error" as it changes, without the user moving focus. */
function StatusHero({ status }: { status: ConnState }) {
  const { t } = useTranslation('connection');
  const cfg = STATUS_CONFIG[status];
  const label = t(`common:connState.${status}`);
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
      accessibilityLabel={t('status.a11y', { status: label })}
      accessibilityLiveRegion="polite"
      testID="connection-status"
    >
      <XStack alignItems="center" gap="$3">
        <Icon size={32} color={colour} />
        <YStack>
          <SectionTitle color={colour}>{label}</SectionTitle>
          <Text fontSize="$2" color="$placeholderColor">
            {t('status.adapter')}
          </Text>
        </YStack>
      </XStack>
    </Card>
  );
}

/** The Wi-Fi adapter branch (plan 26): join the adapter's network, then connect to the endpoint
 *  from Settings. There is nothing to scan and no permission to ask for. */
function WifiConnect({ busy, onConnect }: { busy: boolean; onConnect: () => void }) {
  const { t } = useTranslation('connection');
  const wifi = useSettingsStore((s) => s.wifi);
  return (
    <YStack gap="$3" marginTop="$2" testID="connect-wifi">
      <Panel>
        <YStack gap="$2">
          <Text fontWeight="700" fontSize="$3">
            {t('wifi.title')}
          </Text>
          <Paragraph fontSize="$3">
            <Trans
              i18nKey="connection:wifi.join"
              components={{
                b: <Text fontWeight="700" color="$color" />,
                i: <Text fontStyle="italic" color="$color" />,
              }}
            />
          </Paragraph>
          <Paragraph theme="alt2" fontSize="$2">
            <Trans
              i18nKey="connection:wifi.address"
              values={{ endpoint: formatEndpoint(wifi) }}
              components={{
                b: <Text fontWeight="700" color="$color" testID="connect-wifi-endpoint" />,
              }}
            />
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
        {t('wifi.connect')}
      </Button>
      <Button size="$5" disabled={busy} onPress={() => void switchAdapterSource('ble')}>
        {t('wifi.useBluetooth')}
      </Button>
    </YStack>
  );
}

export function ConnectionScreen() {
  const { t } = useTranslation('connection');
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
    <Screen title={t('title')} subtitle={t(`subtitle.${adapterSource}`)}>
      <StatusHero status={status} />

      <FirstRunCard />

      {sourceNotice ? (
        <Panel testID="adapter-source-notice">
          <Paragraph fontSize="$3">{t(sourceNotice)}</Paragraph>
          <Button size="$3" hitSlop={HIT_SLOP} alignSelf="flex-start" onPress={dismissSourceNotice}>
            {t('common:actions.ok')}
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
              <Trans
                i18nKey="connection:mock.notice"
                values={{ vehicle: simulated }}
                components={{ b: <Text fontWeight="700" color="$color" /> }}
              />
            </Paragraph>
          </Panel>
          <Button
            theme="green"
            size="$5"
            disabled={busy}
            icon={busy ? () => <Spinner /> : undefined}
            onPress={() => connect()}
          >
            {t('mock.connect')}
          </Button>
          <Button size="$5" disabled={busy} onPress={() => void switchToRealAdapter()}>
            {t('mock.useReal')}
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
            {scanning ? t('ble.scanning') : t('ble.scan')}
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
                {Platform.OS === 'android' ? t('ble.noDevicesAndroid') : t('ble.noDevices')}
              </Paragraph>
            ) : null}
            {/* iOS exposes CoreBluetooth UUIDs, not MAC addresses, so there is no connect-by-address
                panel; a Bluetooth LE adapter is never paired in iOS Settings (plan 09). */}
            {Platform.OS === 'ios' ? (
              <Paragraph theme="alt2" fontSize="$2" testID="ios-scan-hint">
                {t('ble.iosHint')}
              </Paragraph>
            ) : null}
          </YStack>

          {Platform.OS === 'android' ? (
            <Panel>
              <YStack gap="$2">
                <Text fontWeight="700" fontSize="$3">
                  {t('ble.byAddress')}
                </Text>
                <Paragraph theme="alt2" fontSize="$2">
                  {t('ble.byAddressHelp')}
                </Paragraph>
                <XStack gap="$2" alignItems="center">
                  <Input
                    flex={1}
                    value={manualId}
                    onChangeText={setManualId}
                    placeholder="AA:BB:CC:DD:EE:FF"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel={t('ble.macLabel')}
                  />
                  <Button
                    theme="green"
                    disabled={busy || manualId.trim().length === 0}
                    onPress={() => connect({ deviceId: manualId.trim().toUpperCase() })}
                  >
                    {t('ble.connect')}
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
            {t('ble.useWifi')}
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
              {t('ble.useSpp')}
            </Button>
          ) : null}
        </YStack>
      )}
    </Screen>
  );
}
