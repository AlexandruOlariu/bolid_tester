import React from 'react';
import { ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { YStack, H3, Paragraph } from 'tamagui';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
}

/** Standard scrollable screen frame with safe-area + optional pull-to-refresh. */
export function Screen({ title, subtitle, onRefresh, refreshing, children }: ScreenProps) {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        {title ? (
          <YStack gap="$1" marginBottom="$2">
            <H3>{title}</H3>
            {subtitle ? <Paragraph theme="alt2">{subtitle}</Paragraph> : null}
          </YStack>
        ) : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
