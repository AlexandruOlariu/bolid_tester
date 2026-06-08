import React from 'react';
import { useRouter } from 'expo-router';
import { Card, YStack, XStack, Text, Paragraph } from 'tamagui';
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
              padding="$3"
              borderColor={active ? '$green8' : undefined}
              borderWidth={active ? 2 : 1}
              onPress={() => {
                select(p.id);
                router.push('/dashboard');
              }}
            >
              <YStack gap="$1">
                <XStack justifyContent="space-between" alignItems="center">
                  <Text fontWeight="800" fontSize="$5">
                    {p.name}
                  </Text>
                  {active ? <Text color="$green10">✓</Text> : null}
                </XStack>
                <Paragraph theme="alt2" fontSize="$2">
                  {PROTOCOL_LABELS[p.expectedProtocol]}
                  {p.extendedPids?.length ? ' · extended PIDs (experimental)' : ''}
                </Paragraph>
                {p.notes ? (
                  <Paragraph theme="alt2" fontSize="$2" numberOfLines={2}>
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
