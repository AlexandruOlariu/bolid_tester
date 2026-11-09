import React from 'react';
import { YStack, Button, Paragraph, Spinner, Text } from 'tamagui';
import { WEB_BLUETOOTH_UNSUPPORTED } from '@/shared/transports/web-ble/WebBluetoothTransport';
import { isWebBluetoothSupported, switchAdapterSource } from '../api/connectionService';
import { Panel } from '../styles/connection.styles';

/** The browser-support note under the Web Bluetooth button. */
export const WEB_BLUETOOTH_NOTE =
  'Works in Chrome and Edge on a computer or an Android phone, over HTTPS. Not in Safari, Firefox ' +
  'or on an iPhone.';

/** The Bluetooth LE branch of the Connect screen in the **browser** (plan 28): no scan list and no
 *  address entry — the browser shows its own device chooser, which only opens from a tap, so one
 *  button picks the adapter and connects. A browser without Web Bluetooth gets a blocking panel
 *  that still offers the simulator. */
export function WebBluetoothConnect({ busy, onChoose }: { busy: boolean; onChoose: () => void }) {
  if (!isWebBluetoothSupported()) {
    return (
      <YStack gap="$3" marginTop="$2">
        <Panel backgroundColor="$yellow2" testID="web-bt-unsupported">
          <Text fontWeight="700" fontSize="$3">
            Bluetooth adapters are not supported in this browser
          </Text>
          <Paragraph fontSize="$3">{WEB_BLUETOOTH_UNSUPPORTED}</Paragraph>
        </Panel>
        <Button theme="green" size="$5" onPress={() => void switchAdapterSource('mock')}>
          Use the simulator
        </Button>
      </YStack>
    );
  }

  return (
    <YStack gap="$3" marginTop="$2" testID="connect-web-bluetooth">
      <Panel>
        <Paragraph fontSize="$3">
          Plug the adapter into the OBD2 port and switch the ignition on. The browser then lists
          nearby Bluetooth devices — pick your OBD2 adapter (often named OBDII, Vgate or IOS-Vlink).
        </Paragraph>
        <Paragraph theme="alt2" fontSize="$2" testID="web-bt-note">
          {WEB_BLUETOOTH_NOTE}
        </Paragraph>
      </Panel>
      <Button
        theme="blue"
        size="$5"
        disabled={busy}
        icon={busy ? () => <Spinner /> : undefined}
        onPress={onChoose}
        testID="web-bt-choose"
      >
        Choose adapter & connect
      </Button>
      <Button
        size="$3"
        chromeless
        alignSelf="flex-start"
        disabled={busy}
        onPress={() => void switchAdapterSource('mock')}
      >
        No adapter? Try the simulator
      </Button>
    </YStack>
  );
}
