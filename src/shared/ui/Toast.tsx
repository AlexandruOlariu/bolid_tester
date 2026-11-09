import React from 'react';
import { View } from 'react-native';
import { XStack, Text, Button } from 'tamagui';
import { hideToast, useToastStore } from '@/shared/state/toastStore';

/** The app's one toast (plan 28): a short message pinned above the tab bar, from `showToast()`.
 *  Mounted once in the root layout; renders nothing while no toast is up. Announced to screen
 *  readers as a live region. */
export function Toast() {
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
          {toast.message}
        </Text>
        <Button
          size="$2"
          chromeless
          color="$color1"
          onPress={hideToast}
          accessibilityLabel="Dismiss"
        >
          OK
        </Button>
      </XStack>
    </View>
  );
}
