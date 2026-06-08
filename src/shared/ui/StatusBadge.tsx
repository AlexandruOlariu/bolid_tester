import React from 'react';
import { Stack, Text } from 'tamagui';
import type { ConnState } from '../state/sessionStore';

const COLORS: Record<ConnState, string> = {
  disconnected: '$gray8',
  connecting: '$yellow8',
  initializing: '$yellow8',
  connected: '$green8',
  error: '$red8',
};

const LABELS: Record<ConnState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  initializing: 'Initializing…',
  connected: 'Connected',
  error: 'Error',
};

export function StatusBadge({ status }: { status: ConnState }) {
  return (
    <Stack
      backgroundColor={COLORS[status]}
      paddingHorizontal="$3"
      paddingVertical="$1.5"
      borderRadius="$10"
      alignSelf="flex-start"
    >
      <Text color="white" fontSize="$2" fontWeight="700">
        {LABELS[status]}
      </Text>
    </Stack>
  );
}
