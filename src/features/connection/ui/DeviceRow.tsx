import React from 'react';
import { XStack, YStack, Text, Button, Paragraph } from 'tamagui';
import type { ScannedDevice } from '../model/scanStore';
import { Panel } from '../styles/connection.styles';

interface DeviceRowProps {
  device: ScannedDevice;
  onConnect: () => void;
  disabled?: boolean;
}

export function DeviceRow({ device, onConnect, disabled }: DeviceRowProps) {
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
        </YStack>
        <Button size="$3" theme="green" onPress={onConnect} disabled={disabled}>
          Connect
        </Button>
      </XStack>
    </Panel>
  );
}
