import React from 'react';
import { YStack, Button, Paragraph, Spinner, Text } from 'tamagui';
import { HIT_SLOP } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';
import { isWebBluetoothSupported, switchAdapterSource } from '../api/connectionService';
import { Panel } from '../styles/connection.styles';

/** The browser-support note under the Web Bluetooth button (an i18n key, plan 11). */
export const WEB_BLUETOOTH_NOTE = 'connection:web.note';

/** The Bluetooth LE branch of the Connect screen in the **browser** (plan 28): no scan list and no
 *  address entry — the browser shows its own device chooser, which only opens from a tap, so one
 *  button picks the adapter and connects. A browser without Web Bluetooth gets a blocking panel
 *  that still offers the simulator. */
export function WebBluetoothConnect({ busy, onChoose }: { busy: boolean; onChoose: () => void }) {
  const { t } = useTranslation('connection');
  if (!isWebBluetoothSupported()) {
    return (
      <YStack gap="$3" marginTop="$2">
        <Panel backgroundColor="$yellow2" testID="web-bt-unsupported">
          <Text fontWeight="700" fontSize="$3">
            {t('web.unsupportedTitle')}
          </Text>
          <Paragraph fontSize="$3">{t('web.unsupported')}</Paragraph>
        </Panel>
        <Button theme="green" size="$5" onPress={() => void switchAdapterSource('mock')}>
          {t('web.useSimulator')}
        </Button>
      </YStack>
    );
  }

  return (
    <YStack gap="$3" marginTop="$2" testID="connect-web-bluetooth">
      <Panel>
        <Paragraph fontSize="$3">{t('web.instructions')}</Paragraph>
        <Paragraph theme="alt2" fontSize="$2" testID="web-bt-note">
          {t(WEB_BLUETOOTH_NOTE)}
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
        {t('web.choose')}
      </Button>
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        chromeless
        alignSelf="flex-start"
        disabled={busy}
        onPress={() => void switchAdapterSource('mock')}
      >
        {t('web.trySimulator')}
      </Button>
    </YStack>
  );
}
