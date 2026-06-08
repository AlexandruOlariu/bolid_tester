import React from 'react';
import { useRouter } from 'expo-router';
import { Card, YStack, XStack, Text, Paragraph } from 'tamagui';
import { CheckCircle2 } from 'lucide-react-native';
import { Screen } from '@/shared/ui';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { PROTOCOL_LABELS } from '@/shared/obd-core/obd/protocols';
import { useVehicleStore } from '../model/vehicleStore';

export function VehicleSelectScreen() {
  const router = useRouter();
  const selectedProfileId = useVehicleStore((s) => s.selectedProfileId);
  const select = useVehicleStore((s) => s.select);

  return (
    <Screen title="Vehicle" subtitle="Pick a profile, or use Auto / Generic for any OBD2 car">
      <YStack gap="$3">
        {VEHICLE_PROFILES.map((p) => {
          const active = p.id === selectedProfileId;
          return (
            <Card
              key={p.id}
              bordered
              padding="$4"
              backgroundColor="$backgroundHover"
              borderColor={active ? '#2bb673' : '$borderColor'}
              borderWidth={active ? 2 : 1}
              borderLeftWidth={active ? 4 : 1}
              borderLeftColor={active ? '#2bb673' : '$borderColor'}
              pressStyle={{ opacity: 0.85, scale: 0.99 }}
              onPress={() => {
                select(p.id);
                router.push('/dashboard');
              }}
            >
              <YStack gap="$2">
                <XStack justifyContent="space-between" alignItems="center">
                  <Text fontWeight="800" fontSize="$5" flex={1}>
                    {p.name}
                  </Text>
                  {active ? <CheckCircle2 size={20} color="#2bb673" /> : null}
                </XStack>
                <XStack
                  backgroundColor="$backgroundPress"
                  paddingHorizontal="$2"
                  paddingVertical="$1"
                  borderRadius="$2"
                  alignSelf="flex-start"
                >
                  <Text fontSize="$1" color="$placeholderColor" fontFamily="monospace">
                    {PROTOCOL_LABELS[p.expectedProtocol]}
                    {p.extendedPids?.length ? ' · experimental' : ''}
                  </Text>
                </XStack>
                {p.notes ? (
                  <Paragraph theme="alt2" fontSize="$2" numberOfLines={3}>
                    {p.notes}
                  </Paragraph>
                ) : null}
              </YStack>
            </Card>
          );
        })}
      </YStack>
    </Screen>
  );
}
