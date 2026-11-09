import React from 'react';
import { Stack, Text } from 'tamagui';
import { i18n, useTranslation } from '@/shared/i18n';
import type { UnlockStatus } from '../security/resolveSeedKey';

/** Status pills use the semantic fills with `$onFill` text (plan 20), as StatusBadge does; the
 *  neutral one keeps the theme's own text on a light grey. */
const COLORS: Record<UnlockStatus['state'], { bg: string; fg: string }> = {
  'none-required': { bg: '$gray6', fg: '$color' },
  unlockable: { bg: '$statusOk', fg: '$onFill' },
  locked: { bg: '$statusError', fg: '$onFill' },
};

/** The text of an unlock badge (plan 23). */
export function unlockBadgeText(status: UnlockStatus): string {
  if (status.state === 'none-required') return i18n.t('unlock.none');
  if (status.state === 'unlockable')
    return i18n.t('unlock.unlockable', { plugin: status.pluginName ?? i18n.t('unlock.plugin') });
  return i18n.t('unlock.locked');
}

/** Security-access pill for one write surface (plan 23): grey "No unlock needed", green
 *  "Unlockable · <plugin>", red "Locked · needs security access". Shown on coding modules, tweaks,
 *  adaptation channels, routines and the service-reset card. */
export function UnlockBadge({ status, testID }: { status: UnlockStatus; testID?: string }) {
  const { t } = useTranslation();
  const c = COLORS[status.state];
  const text = unlockBadgeText(status);
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
      accessibilityLabel={t('unlock.a11y', { text })}
    >
      <Text fontSize="$1" color={c.fg} fontWeight="700">
        {text}
      </Text>
    </Stack>
  );
}
