import React from 'react';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner, Stack } from 'tamagui';
import { Screen } from '@/shared/ui';
import { toHex } from '@/shared/lib/hex';
import { useExtendedPids } from '../hooks/useExtendedPids';

export function ExtendedPidsScreen() {
  const { supported, readings, loading, refresh } = useExtendedPids();

  return (
    <Screen
      title="Extended PIDs"
      subtitle="Experimental manufacturer (Mode 22) reads — values must be confirmed on the real car"
    >
      {!supported ? (
        <Paragraph theme="alt2">
          Not available for this vehicle/connection. Manufacturer Mode 22 reads require a CAN car with
          a profile that declares extended PIDs (e.g. the Golf Plus).
        </Paragraph>
      ) : (
        <YStack gap="$3">
          <Button onPress={refresh} icon={loading ? () => <Spinner /> : undefined} theme="blue">
            Read extended PIDs
          </Button>
          {readings.map((r) => (
            <Card key={r.did} bordered padding="$3" gap="$1">
              <XStack justifyContent="space-between" alignItems="center">
                <Text fontWeight="800">{r.name}</Text>
                {r.experimental ? (
                  <Stack backgroundColor="$yellow8" borderRadius="$10" paddingHorizontal="$2">
                    <Text fontSize="$1" color="black" fontWeight="700">
                      EXPERIMENTAL
                    </Text>
                  </Stack>
                ) : null}
              </XStack>
              <Text fontSize="$7" fontWeight="900">
                {r.value != null ? `${r.value} ${r.unit}` : 'no data'}
              </Text>
              <Paragraph theme="alt2" fontSize="$2">
                DID 22{r.did} · raw {r.raw ? toHex(r.raw, ' ') : '—'}
              </Paragraph>
            </Card>
          ))}
        </YStack>
      )}
    </Screen>
  );
}
