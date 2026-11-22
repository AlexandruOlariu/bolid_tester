import React from 'react';
import { Linking } from 'react-native';
import { YStack, XStack, Button, Paragraph, Spinner, Text } from 'tamagui';
import { logError } from '@/shared/state/errorLogStore';
import { switchAdapterSource } from '../api/connectionService';
import type { ConnectTarget } from '../api/connectionService';
import { usePairedAdapters } from '../hooks/usePairedAdapters';
import { DeviceRow } from './DeviceRow';
import { Panel } from '../styles/connection.styles';
import { Trans, useTranslation } from '@/shared/i18n';

/** Android's system Bluetooth settings screen (where an SPP adapter is paired). */
export const BLUETOOTH_SETTINGS_INTENT = 'android.settings.BLUETOOTH_SETTINGS';

/** Open Android's Bluetooth settings; falls back to the app's own settings page when the intent
 *  cannot be sent (an unusual ROM). */
export async function openBluetoothSettings(): Promise<void> {
  try {
    await Linking.sendIntent(BLUETOOTH_SETTINGS_INTENT);
  } catch (e) {
    logError({ source: 'connection/bluetooth-settings', error: e, severity: 'warning' });
    await Linking.openSettings().catch(() => undefined);
  }
}

/** The Classic Bluetooth (SPP) branch of the Connect screen (plan 27, Android only): the phone's
 *  paired devices — no scanning, an SPP adapter is paired in Android's Bluetooth settings first —
 *  with pairing guidance and a one-tap jump to those settings. */
export function SppConnect({
  busy,
  onConnect,
}: {
  busy: boolean;
  onConnect: (target: ConnectTarget) => void;
}) {
  const { t } = useTranslation('connection');
  const { devices, loading, loaded, error, refresh } = usePairedAdapters(true);
  const empty = loaded && !loading && !error && devices.length === 0;

  return (
    <YStack gap="$3" marginTop="$2" testID="connect-spp">
      <Panel>
        <YStack gap="$2">
          <Text fontWeight="700" fontSize="$3">
            {t('spp.title')}
          </Text>
          <Paragraph theme="alt2" fontSize="$2">
            {t('spp.help')}
          </Paragraph>
        </YStack>
      </Panel>

      {error ? (
        <Paragraph color="$statusError" fontSize="$3" testID="connect-spp-error">
          {error}
        </Paragraph>
      ) : null}

      {loading && !loaded ? <Spinner /> : null}

      <YStack gap="$2">
        {devices.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            disabled={busy}
            onConnect={() => onConnect({ deviceId: d.id, deviceName: d.name ?? undefined })}
          />
        ))}
      </YStack>

      {empty ? (
        <Panel testID="connect-spp-empty">
          <Paragraph fontSize="$3">
            <Trans
              i18nKey="connection:spp.pairFirst"
              components={{ b: <Text fontWeight="700" color="$color" /> }}
            />
          </Paragraph>
        </Panel>
      ) : null}

      <XStack gap="$2" flexWrap="wrap">
        <Button
          flex={1}
          theme={empty ? 'blue' : undefined}
          size="$4"
          onPress={() => void openBluetoothSettings()}
        >
          {t('spp.openSettings')}
        </Button>
        <Button
          flex={1}
          size="$4"
          disabled={loading}
          icon={loading ? () => <Spinner /> : undefined}
          onPress={() => void refresh()}
        >
          {t('spp.refresh')}
        </Button>
      </XStack>

      <Button size="$4" disabled={busy} onPress={() => void switchAdapterSource('ble')}>
        {t('spp.useBle')}
      </Button>
    </YStack>
  );
}
