import React, { useEffect, useRef, useState } from 'react';
import { YStack, XStack, Paragraph, Button, Input } from 'tamagui';
import { HIT_SLOP } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import {
  DEFAULT_WIFI_ENDPOINT,
  formatEndpoint,
  isValidHost,
  parseEndpoint,
} from '@/shared/transports/tcp/endpoint';
import { useTranslation } from '@/shared/i18n';
import { SubLabel } from './parts';

/** The Wi-Fi adapter's address (plan 26), shown under the adapter-source segment while Wi-Fi is
 *  selected. Host and port are edited as text; a valid pair is saved at once, an invalid one shows
 *  why and leaves the saved address untouched. */
export function WifiEndpointSection() {
  const { t } = useTranslation('settings');
  const wifi = useSettingsStore((st) => st.wifi);
  const setWifi = useSettingsStore((st) => st.setWifi);
  const [host, setHost] = useState(wifi.host);
  const [port, setPort] = useState(String(wifi.port));
  // The address these fields last showed or saved. When the stored address changes from elsewhere
  // (a data restore, another setWifi caller) the fields follow it instead of keeping stale text —
  // otherwise the next keystroke would pair with the stale other field and overwrite the restore.
  const shown = useRef(formatEndpoint(wifi));
  useEffect(() => {
    const stored = formatEndpoint(wifi);
    if (stored === shown.current) return;
    shown.current = stored;
    setHost(wifi.host);
    setPort(String(wifi.port));
  }, [wifi]);

  const parsed = parseEndpoint(`${host.trim()}:${port.trim()}`);
  const problem = parsed ? null : !isValidHost(host.trim()) ? t('wifi.badHost') : t('wifi.badPort');

  const edit = (nextHost: string, nextPort: string) => {
    setHost(nextHost);
    setPort(nextPort);
    const ep = parseEndpoint(`${nextHost.trim()}:${nextPort.trim()}`);
    if (ep) {
      shown.current = formatEndpoint(ep);
      setWifi(ep);
    }
  };

  return (
    <YStack gap="$2" testID="settings-wifi">
      <SubLabel>{t('wifi.title')}</SubLabel>
      <XStack gap="$2" alignItems="center">
        <Input
          flex={3}
          value={host}
          onChangeText={(t) => edit(t, port)}
          placeholder={DEFAULT_WIFI_ENDPOINT.host}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel={t('wifi.hostA11y')}
        />
        <Input
          flex={2}
          value={port}
          onChangeText={(t) => edit(host, t)}
          placeholder={String(DEFAULT_WIFI_ENDPOINT.port)}
          keyboardType="number-pad"
          accessibilityLabel={t('wifi.portA11y')}
        />
      </XStack>
      {problem ? (
        <Paragraph color="$statusError" fontSize="$2" testID="settings-wifi-error">
          {problem} {t('wifi.keepsUsing', { endpoint: formatEndpoint(wifi) })}
        </Paragraph>
      ) : null}
      <Paragraph theme="alt2" fontSize="$1">
        {t('wifi.help', { endpoint: formatEndpoint(DEFAULT_WIFI_ENDPOINT) })}
      </Paragraph>
      {formatEndpoint(wifi) !== formatEndpoint(DEFAULT_WIFI_ENDPOINT) ? (
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          alignSelf="flex-start"
          onPress={() => edit(DEFAULT_WIFI_ENDPOINT.host, String(DEFAULT_WIFI_ENDPOINT.port))}
        >
          {t('wifi.useDefault')}
        </Button>
      ) : null}
    </YStack>
  );
}
