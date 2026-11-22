import React from 'react';
import { Button, Text, XStack } from 'tamagui';
import { FlaskConical } from 'lucide-react-native';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { switchToRealAdapter } from '../api/connectionService';
import { usePalette, HIT_SLOP } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';

/** App-wide amber strip shown whenever the simulator is the adapter source (or a simulator session is
 *  live), so simulated readings are never mistaken for the real car. Mounted once in the root layout
 *  (above the tab navigator), so it sits under the header on every route, hidden routes included.
 *  Renders nothing for a real adapter. */
export function SimulatorBanner() {
  const { t } = useTranslation('connection');
  const palette = usePalette();
  const adapterSource = useSettingsStore((s) => s.adapterSource);
  const simulated = useSettingsStore((s) => s.simulatedVehicleId);
  // Belt and braces: also flag a live simulator session (device id 'mock'), should one ever outlive
  // the setting. switchAdapterSource() tears it down, so normally both agree.
  const simSession = useSessionStore((s) => s.deviceId === 'mock');
  if (adapterSource !== 'mock' && !simSession) return null;

  return (
    <XStack
      width="100%"
      alignItems="center"
      gap="$2"
      paddingHorizontal="$3"
      paddingVertical="$1"
      backgroundColor="$yellow3"
      borderBottomWidth={1}
      borderBottomColor="$yellow7"
      accessibilityRole="alert"
      accessibilityLabel={t('banner.a11y')}
    >
      <FlaskConical size={16} color={palette.statusWarn} />
      <Text flex={1} fontSize="$2" fontWeight="700" color="$yellow11" numberOfLines={1}>
        {t('banner.text', { vehicle: simulated })}
      </Text>
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        chromeless
        color="$yellow11"
        onPress={() => void switchToRealAdapter()}
      >
        {t('banner.useReal')}
      </Button>
    </XStack>
  );
}
