import React from 'react';
import { ScrollView, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, YStack, H2, Paragraph } from 'tamagui';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
}

/** Standard scrollable screen frame with safe-area + optional pull-to-refresh. */
export function Screen({ title, subtitle, onRefresh, refreshing, children }: ScreenProps) {
  const theme = useTheme();
  const bg = (theme.background?.val ?? '#0D1117') as string;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['bottom']}>
      <ScrollView
        style={{ flex: 1, backgroundColor: bg }}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        {title ? (
          <YStack gap="$1" marginBottom="$3">
            <View
              style={{
                borderLeftWidth: 3,
                borderLeftColor: '#2bb673',
                paddingLeft: 10,
              }}
            >
              <H2 fontWeight="800">{title}</H2>
              {subtitle ? <Paragraph theme="alt2" fontSize="$3">{subtitle}</Paragraph> : null}
            </View>
          </YStack>
        ) : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
