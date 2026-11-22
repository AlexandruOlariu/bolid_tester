import React from 'react';
import { Stack, Text } from 'tamagui';
import { useTranslation } from '@/shared/i18n';
import type { TFunction } from '@/shared/i18n';
import {
  verificationState,
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
  const { t } = useTranslation();
  const state = verificationState(item);
  const text = verificationLabel(item, t);
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
      accessibilityLabel={t('verification.a11y', { text })}
    >
      <Text fontSize="$1" color="$onFill" fontWeight="700">
        {text}
      </Text>
    </Stack>
  );
}

/** The badge text in the UI language (plan 11); the English form is `verificationText` in
 *  `shared/vehicles/confirmation.ts`. */
export function verificationLabel(item: VerifiableItem, t: TFunction): string {
  const state = verificationState(item);
  if (state === 'standard') return t('verification.standard');
  if (state === 'confirmed' && item.confirmed) {
    const { on, source } = item.confirmed;
    return t('verification.confirmed', {
      on,
      source: t(`verification.source.${source}`, { defaultValue: source }),
    });
  }
  return t('verification.unverified');
}
