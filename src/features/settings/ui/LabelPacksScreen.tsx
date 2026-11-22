import React from 'react';
import { Screen } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';
import { useBackToSettings } from '../hooks/useBackToSettings';
import { LabelPacksSection } from './LabelPacksSection';

/** Settings → **Label packs** (plan 13, route `/settings-label-packs`). */
export function LabelPacksScreen() {
  const { t } = useTranslation('settings');
  useBackToSettings();
  return (
    <Screen title={t('packs.title')}>
      <LabelPacksSection />
    </Screen>
  );
}
