import React, { useState } from 'react';
import { Platform, Linking } from 'react-native';
import { YStack, XStack, Button, Paragraph, Text, Spinner } from 'tamagui';
import { BluetoothOff } from 'lucide-react-native';
import { enableBluetooth } from '@/shared/transports/ble/manager';
import type { BluetoothState } from '../hooks/useBluetoothState';
import { Panel } from '../styles/connection.styles';

const ACCENT = '#E3B341'; // amber, matching the connecting/initializing status color

/** Banner shown on the Connect screen when the phone's Bluetooth radio isn't ready. Guides the user
 *  to fix it — with a one-tap "Turn on Bluetooth" (Android) or "Open settings" action where the OS
 *  allows it. Renders nothing while ready or still settling. */
export function BluetoothPrompt({ bt }: { bt: BluetoothState }) {
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
      setHint('Couldn’t turn Bluetooth on automatically — open Quick Settings and enable it.');
    }
  };

  let title: string;
  let body: string;
  let action: React.ReactNode = null;

  if (bt.unsupported) {
    title = 'Bluetooth LE not available';
    body =
      'This device doesn’t support Bluetooth Low Energy, so a wireless OBD2 adapter can’t be used. ' +
      'You can still use the built-in simulator (Settings).';
  } else if (bt.unauthorized) {
    title = 'Bluetooth permission needed';
    body =
      Platform.OS === 'ios'
        ? 'Allow Bluetooth for Bolid Tester in Settings, then return here.'
        : 'Allow “Nearby devices” for Bolid Tester in system settings, then return here.';
    action = (
      <Button size="$3" theme="yellow" onPress={() => Linking.openSettings()}>
        Open settings
      </Button>
    );
  } else {
    // poweredOff
    title = 'Bluetooth is off';
    if (Platform.OS === 'android') {
      body = 'Turn Bluetooth on to scan for your OBD2 adapter.';
      action = (
        <Button
          size="$3"
          theme="yellow"
          disabled={busy}
          icon={busy ? () => <Spinner /> : undefined}
          onPress={turnOn}
        >
          {busy ? 'Turning on…' : 'Turn on Bluetooth'}
        </Button>
      );
    } else {
      body = 'Open Control Center and turn Bluetooth on to scan for your OBD2 adapter.';
    }
  }

  return (
    <Panel backgroundColor="$yellow2" borderColor={ACCENT}>
      <XStack gap="$3" alignItems="flex-start">
        <BluetoothOff size={24} color={ACCENT} />
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
