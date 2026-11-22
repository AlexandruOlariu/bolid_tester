import React from 'react';
import { Screen } from '@/shared/ui';
import { useTranslation } from '@/shared/i18n';
import { useBackToSettings } from '../hooks/useBackToSettings';
import { SeedKeysSection } from './SeedKeysSection';

/** Settings → **Security access plugins** (plan 23, route `/settings-plugins`). */
export function SeedKeysScreen() {
  const { t } = useTranslation('settings');
  useBackToSettings();
  return (
    <Screen title={t('seed.title')}>
      <SeedKeysSection />
    </Screen>
  );
}
