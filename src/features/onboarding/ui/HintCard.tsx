import React from 'react';
import { Card, XStack, YStack, Text, Paragraph } from 'tamagui';
import { Lightbulb, X } from 'lucide-react-native';
import { useOnboardingStore } from '../model/onboardingStore';

interface HintCardProps {
  /** Stable id for this hint; once dismissed it stays hidden across launches. */
  id: string;
  title: string;
  children: React.ReactNode;
}

/** A dismissible first-run hint. Renders nothing once its `id` has been dismissed. */
export function HintCard({ id, title, children }: HintCardProps) {
  const dismissed = useOnboardingStore((s) => s.dismissed);
  const dismiss = useOnboardingStore((s) => s.dismiss);
  if (dismissed.includes(id)) return null;

  return (
    <Card bordered padding="$3" backgroundColor="$blue2" borderColor="$blue7">
      <XStack gap="$2" alignItems="flex-start">
        <Lightbulb size={20} color="#4c9df3" />
        <YStack flex={1} gap="$1">
          <Text fontWeight="800" fontSize="$4">
            {title}
          </Text>
          <Paragraph theme="alt2" size="$2">
            {children}
          </Paragraph>
        </YStack>
        <XStack
          padding="$1"
          pressStyle={{ opacity: 0.6 }}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss hint: ${title}`}
          onPress={() => dismiss(id)}
        >
          <X size={18} color="#8B949E" />
        </XStack>
      </XStack>
    </Card>
  );
}
