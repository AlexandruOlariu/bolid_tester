import React from 'react';
import { View } from 'react-native';
import { XStack, Text, Button } from 'tamagui';
import { useTranslation } from '@/shared/i18n';
import { hideToast, useToastStore } from '@/shared/state/toastStore';
import { HIT_SLOP } from './SegmentedControl';

/** The app's one toast (plan 28): a short message pinned above the tab bar, from `showToast()`.
 *  Mounted once in the root layout; renders nothing while no toast is up. Announced to screen
 *  readers as a live region. */
export function Toast() {
  const { t, i18n } = useTranslation();
  const toast = useToastStore((s) => s.toast);
  if (!toast) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 72, alignItems: 'center' }}
    >
      <XStack
        testID="toast"
        maxWidth={520}
        marginHorizontal="$3"
        alignItems="center"
        gap="$2"
        paddingVertical="$2"
        paddingHorizontal="$3"
        borderRadius="$4"
        backgroundColor="$color12"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Text flex={1} fontSize="$3" color="$color1">
          {/* A message that is an i18n key (`NOT_ON_WEB_YET`) follows the UI language (plan 11). */}
          {i18n.exists(toast.message) ? t(toast.message) : toast.message}
        </Text>
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          chromeless
          color="$color1"
          onPress={hideToast}
          accessibilityLabel={t('actions.dismiss')}
        >
          {t('actions.ok')}
        </Button>
      </XStack>
    </View>
  );
}
