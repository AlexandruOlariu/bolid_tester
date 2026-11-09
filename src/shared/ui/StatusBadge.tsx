import React from 'react';
import { Stack, Text } from 'tamagui';
import type { ConnState } from '../state/sessionStore';

/** Fill tokens (plan 20): the semantic colours, with `$onFill` text on them — ink on the dark
 *  theme's bright fills, white on the light theme's deep ones; `npm run check:contrast` holds every
 *  pair to 4.5:1 (white on the old `$green8` fill was 2.6:1). */
const COLORS: Record<ConnState, string> = {
  disconnected: '$muted',
  connecting: '$statusWarn',
  initializing: '$statusWarn',
  connected: '$accent',
  error: '$statusError',
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
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Connection status: ${LABELS[status]}`}
    >
      <Text color="$onFill" fontSize="$2" fontWeight="700">
        {LABELS[status]}
      </Text>
    </Stack>
  );
}
