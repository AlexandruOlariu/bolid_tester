import React from 'react';
import { Stack, Text } from 'tamagui';
import {
  verificationState,
  verificationText,
  type VerifiableItem,
  type VerificationState,
} from '../vehicles/confirmation';

/** Semantic fills with `$onFill` text (plan 20), the StatusBadge pattern: every pair is held to
 *  4.5:1 in both themes by `npm run check:contrast` (white on `$green8` / `$blue8` was 2.4:1). */
const COLORS: Record<VerificationState, string> = {
  standard: '$statusOk',
  confirmed: '$statusInfo',
  unverified: '$statusWarn',
};

/** Verification pill for one per-car profile item (plan 25): green "Standard OBD2", blue
 *  "Confirmed <date> (<source>)", amber "Illustrative — not yet confirmed on this car". Replaces
 *  the per-item "experimental / unverified" strings on the feature screens. */
export function VerificationBadge({ item, testID }: { item: VerifiableItem; testID?: string }) {
  const state = verificationState(item);
  const text = verificationText(item);
  return (
    <Stack
      testID={testID}
      backgroundColor={COLORS[state]}
      borderRadius="$10"
      paddingHorizontal="$2"
      paddingVertical={2}
      alignSelf="flex-start"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Verification: ${text}`}
    >
      <Text fontSize="$1" color="$onFill" fontWeight="700">
        {text}
      </Text>
    </Stack>
  );
}
