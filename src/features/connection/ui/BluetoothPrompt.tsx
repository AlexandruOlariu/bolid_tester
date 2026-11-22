import React, { useState } from 'react';
import { Platform, Linking } from 'react-native';
import { YStack, XStack, Button, Paragraph, Text, Spinner } from 'tamagui';
import { BluetoothOff } from 'lucide-react-native';
import { enableBluetooth } from '@/shared/transports/ble/manager';
import type { BluetoothState } from '../hooks/useBluetoothState';
import { usePalette, HIT_SLOP } from '@/shared/ui';
import { Panel } from '../styles/connection.styles';
import { useTranslation } from '@/shared/i18n';

/** Banner shown on the Connect screen when the phone's Bluetooth radio isn't ready. Guides the user
 *  to fix it — with a one-tap "Turn on Bluetooth" (Android) or "Open settings" action where the OS
 *  allows it. Renders nothing while ready or still settling. */
export function BluetoothPrompt({ bt }: { bt: BluetoothState }) {
  const { t } = useTranslation('connection');
  const palette = usePalette();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  if (bt.ready || bt.checking) return null;

  const turnOn = async () => {
    setBusy(true);
    setHint(null);
    const ok = await enableBluetooth();
    setBusy(false);
    // On success the onStateChange subscription flips `bt.ready` and this banner unmounts itself.
    if (!ok) {
      setHint(t('prompt.turnOnFailed'));
    }
  };

  let title: string;
  let body: string;
  let action: React.ReactNode = null;

  if (bt.unsupported) {
    title = t('prompt.unsupportedTitle');
    body = t('prompt.unsupportedBody');
  } else if (bt.unauthorized) {
    title = t('prompt.permissionTitle');
    body = Platform.OS === 'ios' ? t('prompt.permissionIos') : t('prompt.permissionAndroid');
    action = (
      <Button size="$3" hitSlop={HIT_SLOP} theme="yellow" onPress={() => Linking.openSettings()}>
        {t('prompt.openSettings')}
      </Button>
    );
  } else {
    // poweredOff
    title = t('prompt.offTitle');
    if (Platform.OS === 'android') {
      body = t('prompt.offAndroid');
      action = (
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          theme="yellow"
          disabled={busy}
          icon={busy ? () => <Spinner /> : undefined}
          onPress={turnOn}
        >
          {busy ? t('prompt.turningOn') : t('prompt.turnOn')}
        </Button>
      );
    } else {
      body = t('prompt.offIos');
    }
  }

  return (
    <Panel backgroundColor="$yellow2" borderColor={palette.statusWarn}>
      <XStack gap="$3" alignItems="flex-start">
        <BluetoothOff size={24} color={palette.statusWarn} />
        <YStack flex={1} gap="$2">
          <Text fontWeight="800" fontSize="$4" color="$yellow11">
            {title}
          </Text>
          <Paragraph fontSize="$3" color="$yellow11">
            {body}
          </Paragraph>
          {hint ? (
            <Paragraph fontSize="$2" color="$yellow11">
              {hint}
            </Paragraph>
          ) : null}
          {action ? <XStack marginTop="$1">{action}</XStack> : null}
        </YStack>
      </XStack>
    </Panel>
  );
}
