import React from 'react';
import { useRouter } from 'expo-router';
import { YStack, Paragraph, Button } from 'tamagui';
import { Screen, SegmentedControl, LabeledSwitch, type SegmentOption } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useLabelPackStore } from '@/shared/state/labelPackStore';
import { useSeedKeyStore } from '@/shared/state/seedKeyStore';
import { LABEL_PACKS } from '@/shared/labels';
import { AI_PROVIDER_PRESETS } from '@/shared/obd-core';
import { connectionService } from '@/features/connection';
import { APP_BUILD, APP_VERSION } from '@/shared/lib/appInfo';
import { isCrashReportingAvailable } from '@/shared/telemetry/crashReporting';
import { initI18n, useTranslation, type TFunction } from '@/shared/i18n';
import type { LanguagePref } from '@/shared/lib/i18nResolve';
import { SectionLabel, SegGroup } from './parts';
import { SettingsRow, SettingsRowGroup } from './SettingsRow';

const pollOptions = (t: TFunction): SegmentOption<number>[] =>
  [250, 500, 1000, 2000].map((ms) => ({
    value: ms,
    label: `${ms} ms`,
    accessibilityLabel: t('milliseconds', { count: ms }),
  }));

const themeOptions = (t: TFunction): SegmentOption<'system' | 'light' | 'dark'>[] => [
  {
    value: 'system',
    label: t('general.themeSystem'),
    accessibilityLabel: t('general.themeSystemA11y'),
  },
  {
    value: 'light',
    label: t('general.themeLight'),
    accessibilityLabel: t('general.themeLightA11y'),
  },
  { value: 'dark', label: t('general.themeDark'), accessibilityLabel: t('general.themeDarkA11y') },
];

/** The language picker (plan 11): follow the phone, or a fixed language. Language names are shown in
 *  their own language (endonyms) so anyone can find theirs. */
const languageOptions = (t: TFunction): SegmentOption<LanguagePref>[] => [
  { value: 'system', label: t('general.languageSystem') },
  { value: 'en', label: 'English', accessibilityLabel: 'English' },
  { value: 'ro', label: 'Română', accessibilityLabel: 'Română' },
];

/** A grey one-line hint under a setting. */
function Hint({ children }: { children: string }) {
  return (
    <Paragraph theme="alt2" fontSize="$1">
      {children}
    </Paragraph>
  );
}

/** **General**: the theme and the UI language (plan 11). The app is metric only. */
function GeneralSection() {
  const { t } = useTranslation('settings');
  const theme = useSettingsStore((st) => st.theme);
  const setTheme = useSettingsStore((st) => st.setTheme);
  const language = useSettingsStore((st) => st.language);
  const setLanguagePref = useSettingsStore((st) => st.setLanguage);
  const changeLanguage = (pref: LanguagePref) => {
    setLanguagePref(pref);
    // Applied at once (the root layout's useLanguageSync would follow the stored choice too).
    void initI18n(pref);
  };
  return (
    <YStack gap="$2">
      <SectionLabel>{t('general.title')}</SectionLabel>
      <SegGroup>
        <YStack gap="$2">
          <Paragraph theme="alt2" fontSize="$2">
            {t('general.theme')}
          </Paragraph>
          <SegmentedControl
            label={t('general.theme')}
            options={themeOptions(t)}
            value={theme}
            onChange={setTheme}
          />
          <Paragraph theme="alt2" fontSize="$2">
            {t('general.language')}
          </Paragraph>
          <SegmentedControl
            label={t('general.language')}
            options={languageOptions(t)}
            value={language}
            onChange={changeLanguage}
            testID="settings-language"
          />
          <Hint>{t('general.units')}</Hint>
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** **Connection**: auto-reconnect, the poll interval and VIN recognition of garage cars, each with a
 *  one-line hint (the details are in docs/features/settings.md). */
function ConnectionSection() {
  const { t } = useTranslation('settings');
  const s = useSettingsStore();
  return (
    <YStack gap="$2">
      <SectionLabel>{t('connection.title')}</SectionLabel>
      <SegGroup>
        <YStack gap="$3">
          <YStack gap="$1">
            <LabeledSwitch
              label={t('connection.autoReconnect')}
              checked={s.autoReconnect}
              onCheckedChange={s.setAutoReconnect}
              testID="settings-auto-reconnect"
            />
            <Hint>{t('connection.autoReconnectLabel')}</Hint>
          </YStack>

          <YStack gap="$2">
            <Paragraph theme="alt2" fontSize="$2">
              {t('connection.poll')}
            </Paragraph>
            <SegmentedControl
              label={t('connection.poll')}
              options={pollOptions(t)}
              value={s.pollIntervalMs}
              onChange={s.setPollInterval}
            />
            <Hint>{t('connection.pollHelp')}</Hint>
          </YStack>

          <YStack gap="$1">
            <LabeledSwitch
              label={t('connection.byVin')}
              checked={s.autoSelectByVin}
              onCheckedChange={s.setAutoSelectByVin}
              testID="settings-auto-select-vin"
            />
            <Hint>{t('connection.byVinLabel')}</Hint>
          </YStack>
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** The rows to the Settings pages, each with its current state. */
function PageRows() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  const ai = useSettingsStore((st) => st.ai);
  const crashReports = useSettingsStore((st) => st.crashReports);
  const adapterSource = useSettingsStore((st) => st.adapterSource);
  const importedPacks = useLabelPackStore((st) => st.packs.length);
  const plugins = useSeedKeyStore((st) => st.plugins.length);

  const provider = t(`ai.providerLabel.${ai.provider}`, {
    defaultValue: AI_PROVIDER_PRESETS[ai.provider]?.label ?? ai.provider,
  });
  const privacyStatus = !isCrashReportingAvailable()
    ? t('hub.crashUnavailable')
    : crashReports
      ? t('hub.crashOn')
      : t('hub.crashOff');

  return (
    <SettingsRowGroup>
      <SettingsRow
        title={t('hub.ai')}
        status={ai.enabled ? t('hub.aiOn', { provider }) : t('hub.aiOff')}
        onPress={() => router.push('/settings-ai')}
        testID="settings-row-ai"
      />
      <SettingsRow
        title={t('notifications.title')}
        status={t('notifications.rowHelp')}
        onPress={() => router.push('/notifications')}
        testID="settings-row-notifications"
      />
      <SettingsRow
        title={t('privacy.title')}
        status={privacyStatus}
        onPress={() => router.push('/settings-privacy')}
        testID="settings-row-privacy"
      />
      <SettingsRow
        title={t('data.backup')}
        status={t('hub.backupStatus')}
        onPress={() => router.push('/backup')}
        testID="settings-row-backup"
      />
      <SettingsRow
        title={t('packs.title')}
        status={t('hub.packsStatus', { bundled: LABEL_PACKS.length, imported: importedPacks })}
        onPress={() => router.push('/settings-label-packs')}
        testID="settings-row-label-packs"
      />
      <SettingsRow
        title={t('seed.title')}
        status={plugins === 0 ? t('hub.pluginsNone') : t('hub.pluginsInstalled', { n: plugins })}
        onPress={() => router.push('/settings-plugins')}
        testID="settings-row-plugins"
      />
      <SettingsRow
        title={t('dev.title')}
        status={t(`hub.source.${adapterSource}`)}
        onPress={() => router.push('/settings-developer')}
        testID="settings-row-developer"
      />
      <SettingsRow
        title={t('about.title')}
        status={
          APP_BUILD
            ? t('hub.versionBuild', { version: APP_VERSION, build: APP_BUILD })
            : t('hub.version', { version: APP_VERSION })
        }
        onPress={() => router.push('/settings-about')}
        testID="settings-row-about"
      />
    </SettingsRowGroup>
  );
}

/** **Settings** (plan 07): a short hub. General and Connection stay inline; every other area is a
 *  row that opens its own page (AI assistant, Notifications, Privacy, Backup & restore, Label packs,
 *  Security access plugins, Developer & simulator, About). Then **Disconnect** while connected. */
export function SettingsScreen() {
  const { t } = useTranslation('settings');
  const status = useSessionStore((st) => st.status);

  return (
    <Screen title={t('title')}>
      <GeneralSection />

      <ConnectionSection />

      <PageRows />

      {status === 'connected' ? (
        <Button theme="red" onPress={() => connectionService.disconnect()}>
          {t('disconnect')}
        </Button>
      ) : null}
    </Screen>
  );
}
