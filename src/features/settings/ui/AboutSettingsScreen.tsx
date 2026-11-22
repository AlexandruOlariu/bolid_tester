import React, { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { YStack, Text, Paragraph } from 'tamagui';
import { Screen } from '@/shared/ui';
import { logError } from '@/shared/state/errorLogStore';
import {
  ANDROID_PACKAGE,
  APP_BUILD,
  APP_NAME,
  APP_STORE_ID,
  APP_VERSION,
  DOCS_URL,
} from '@/shared/lib/appInfo';
import { rateAppLinks } from '@/shared/lib/storeLinks';
import { i18n, useTranslation } from '@/shared/i18n';
import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED } from '../model/privacyPolicy';
import { useBackToSettings } from '../hooks/useBackToSettings';
import { SegGroup } from './parts';
import { SettingsRow, SettingsRowGroup } from './SettingsRow';

/** Open the store's review page in the store app, falling back to its web page when the store app
 *  is missing (an emulator without Play, a de-Googled phone). */
function openRatePage(links: { primary: string; fallback: string }) {
  Linking.openURL(links.primary).catch(() =>
    Linking.openURL(links.fallback).catch((e: unknown) =>
      logError({ source: 'settings/about', error: e, severity: 'warning' }),
    ),
  );
}

/** Settings → **About** (plan 08, plan 07, plan 30, route `/settings-about`): the app version (= the
 *  OTA runtime version) and the build when `app.json` carries one, then a list of rows: **Rate this
 *  app** (Play / App Store; hidden on the web and on iOS until the App Store id exists), the privacy
 *  policy (expands in place; its text lives in `model/privacyPolicy.ts` and is published as
 *  docs/privacy-policy.md), **Report a problem** (`/feedback`, plan 32), **Licences** (`/licenses`,
 *  the third-party notices) and the documentation. */
export function AboutSettingsScreen() {
  const { t } = useTranslation('settings');
  useBackToSettings();
  const router = useRouter();
  const [policyOpen, setPolicyOpen] = useState(false);
  const rate = rateAppLinks(Platform.OS, {
    androidPackage: ANDROID_PACKAGE,
    appStoreId: APP_STORE_ID,
  });

  return (
    <Screen title={t('about.title')}>
      <SegGroup>
        <YStack gap="$1">
          <Paragraph fontWeight="700">
            {APP_NAME} {APP_VERSION}
          </Paragraph>
          {APP_BUILD ? (
            <Paragraph theme="alt2" fontSize="$2">
              {t('about.build', { build: APP_BUILD })}
            </Paragraph>
          ) : null}
          <Paragraph theme="alt2" fontSize="$1">
            {t('about.ota')}
          </Paragraph>
        </YStack>
      </SegGroup>

      <SettingsRowGroup>
        {rate ? (
          <SettingsRow
            title={t('about.rate')}
            accessibilityLabel={t('about.rateA11y')}
            trailing="↗"
            onPress={() => openRatePage(rate)}
          />
        ) : null}
        <SettingsRow
          title={policyOpen ? t('about.hidePolicy') : t('about.policy')}
          accessibilityLabel={policyOpen ? t('about.hidePolicyA11y') : t('about.showPolicyA11y')}
          trailing={policyOpen ? '▴' : '▾'}
          onPress={() => setPolicyOpen((open) => !open)}
        />
        <SettingsRow
          title={t('about.report')}
          accessibilityLabel={t('about.reportA11y')}
          onPress={() => router.push('/feedback')}
        />
        <SettingsRow
          title={t('about.licenses')}
          accessibilityLabel={t('about.licensesA11y')}
          onPress={() => router.push('/licenses')}
        />
        <SettingsRow
          title={t('about.docs')}
          accessibilityLabel={t('about.docsA11y')}
          trailing="↗"
          onPress={() =>
            Linking.openURL(DOCS_URL).catch((e: unknown) =>
              logError({ source: 'settings/about', error: e, severity: 'warning' }),
            )
          }
        />
      </SettingsRowGroup>

      {policyOpen ? (
        <SegGroup>
          <YStack gap="$2" testID="settings-privacy-policy">
            <Paragraph theme="alt2" fontSize="$1">
              {t('about.policyUpdated', { date: PRIVACY_POLICY_UPDATED })}
            </Paragraph>
            {i18n.language !== 'en' ? (
              <Paragraph theme="alt2" fontSize="$1">
                {t('about.policyEnglishOnly')}
              </Paragraph>
            ) : null}
            {PRIVACY_POLICY.map((section) => (
              <YStack key={section.heading} gap="$1">
                <Text fontWeight="700" fontSize="$3" role="heading" accessibilityRole="header">
                  {section.heading}
                </Text>
                {section.paragraphs.map((p) => (
                  <Paragraph key={p} fontSize="$2">
                    {p}
                  </Paragraph>
                ))}
              </YStack>
            ))}
          </YStack>
        </SegGroup>
      ) : null}
    </Screen>
  );
}
