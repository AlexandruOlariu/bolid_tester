import React from 'react';
import { Stack, Text } from 'tamagui';
import {
  verificationState,
  verificationText,
  type VerifiableItem,
  type VerificationState,
} from '../vehicles/confirmation';

const COLORS: Record<VerificationState, { bg: string; fg: string }> = {
  standard: { bg: '$green8', fg: 'white' },
  confirmed: { bg: '$blue8', fg: 'white' },
  unverified: { bg: '$yellow8', fg: 'black' },
};

/** Verification pill for one per-car profile item (plan 25): green "Standard OBD2", blue
 *  "Confirmed <date> (<source>)", amber "Illustrative — not yet confirmed on this car". Replaces
 *  the per-item "experimental / unverified" strings on the feature screens. */
export function VerificationBadge({ item, testID }: { item: VerifiableItem; testID?: string }) {
  const state = verificationState(item);
  const text = verificationText(item);
  const c = COLORS[state];
  return (
    <Stack
      testID={testID}
      backgroundColor={c.bg}
      borderRadius="$10"
      paddingHorizontal="$2"
      paddingVertical={2}
      alignSelf="flex-start"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Verification: ${text}`}
    >
      <Text fontSize="$1" color={c.fg} fontWeight="700">
        {text}
      </Text>
    </Stack>
  );
}
