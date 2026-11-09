import React from 'react';
import { ScrollView, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, H2, Paragraph } from 'tamagui';
import { useLayoutClass } from './useLayoutClass';
import { usePalette } from './usePalette';
import { CONTENT_MAX_WIDTH, isTwoPane } from './layoutClass';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Use the full window width on tablets instead of the centred ≤ 1100 dp column (plan 21) — for
   *  screens that lay out their own columns (Live, Charts, the sniffer table). */
  wide?: boolean;
  children: React.ReactNode;
}

/** Standard scrollable screen frame with safe-area + optional pull-to-refresh. On medium / expanded
 *  windows (plan 21) the padding grows to 24 and the content is a centred column capped at
 *  `CONTENT_MAX_WIDTH` unless `wide`. */
export function Screen({ title, subtitle, onRefresh, refreshing, wide, children }: ScreenProps) {
  const palette = usePalette();
  const bg = palette.background;
  const layout = useLayoutClass();
  const roomy = isTwoPane(layout);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['bottom']}>
      <ScrollView
        style={{ flex: 1, backgroundColor: bg }}
        contentContainerStyle={{ padding: roomy ? 24 : 16 }}
        // iOS: scroll a focused input (e.g. Settings → Server URL on a phone in landscape) above
        // the keyboard. The prop is iOS-only; on Android (edge-to-edge on Expo 56 / RN 0.85) whether
        // `adjustResize` still shrinks the window is unverified — a device check (implementation log,
        // plan 21) decides if Android needs its own keyboard handling here.
        automaticallyAdjustKeyboardInsets
        refreshControl={
          onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        <YStack
          testID="screen-content"
          width="100%"
          maxWidth={roomy && !wide ? CONTENT_MAX_WIDTH : undefined}
          alignSelf="center"
          gap={12}
        >
          {title ? (
            <YStack gap="$1" marginBottom="$3">
              <View
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: palette.accent,
                  paddingLeft: 10,
                }}
              >
                {/* The screen title is a heading (plan 20): screen readers can jump to it. */}
                <H2 fontWeight="800" role="heading" accessibilityRole="header">
                  {title}
                </H2>
                {subtitle ? (
                  <Paragraph theme="alt2" fontSize="$3">
                    {subtitle}
                  </Paragraph>
                ) : null}
              </View>
            </YStack>
          ) : null}
          {children}
        </YStack>
      </ScrollView>
    </SafeAreaView>
  );
}
