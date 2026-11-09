import React from 'react';
import { XStack, YStack, Text, Button, Paragraph, Stack } from 'tamagui';
import {
  communitySummary,
  knownAdapterChip,
  matchKnownAdapter,
  type KnownAdapter,
} from '@/shared/adapters';
import type { ScannedDevice } from '../model/scanStore';
import { Panel } from '../styles/connection.styles';

interface DeviceRowProps {
  device: ScannedDevice;
  onConnect: () => void;
  disabled?: boolean;
}

const CHIP_COLORS: Record<KnownAdapter['typicalGrade'], { bg: string; fg: string }> = {
  good: { bg: '$green8', fg: 'white' },
  ok: { bg: '$yellow8', fg: 'black' },
  poor: { bg: '$red8', fg: 'white' },
};

/** "known good" / "known ok" / "known poor" — the community compatibility matrix's typical grade for
 *  this advertised name (plan 29, `@/shared/adapters`). */
function KnownAdapterChip({ known }: { known: KnownAdapter }) {
  const c = CHIP_COLORS[known.typicalGrade];
  return (
    <Stack
      testID="known-adapter-chip"
      backgroundColor={c.bg}
      borderRadius="$10"
      paddingHorizontal="$2"
      paddingVertical={2}
      alignSelf="flex-start"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Known adapter: ${communitySummary(known)}`}
    >
      <Text fontSize="$1" color={c.fg} fontWeight="700">
        {knownAdapterChip(known)}
      </Text>
    </Stack>
  );
}

export function DeviceRow({ device, onConnect, disabled }: DeviceRowProps) {
  const known = matchKnownAdapter(device.name);
  return (
    <Panel>
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <YStack flex={1}>
          <Text fontWeight="700" numberOfLines={1}>
            {device.name ?? '(unnamed)'}
            {device.isLikelyAdapter ? '  ⭐' : ''}
          </Text>
          <Paragraph theme="alt2" fontSize="$2" numberOfLines={1}>
            {device.id}
            {device.rssi != null ? ` · ${device.rssi} dBm` : ''}
          </Paragraph>
          {known ? <KnownAdapterChip known={known} /> : null}
        </YStack>
        <Button
          size="$3"
          theme="green"
          onPress={onConnect}
          disabled={disabled}
          accessibilityLabel={`Connect to ${device.name ?? device.id}`}
        >
          Connect
        </Button>
      </XStack>
    </Panel>
  );
}
