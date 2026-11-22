import React from 'react';
import { Linking } from 'react-native';
import { YStack, Paragraph, Button } from 'tamagui';
import { Screen, appAlert, LabeledSwitch, HIT_SLOP } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { logError } from '@/shared/state/errorLogStore';
import { PRIVACY_POLICY_URL } from '@/shared/lib/appInfo';
import { isCrashReportingAvailable } from '@/shared/telemetry/crashReporting';
import { useTranslation } from '@/shared/i18n';
import { useBackToSettings } from '../hooks/useBackToSettings';
import { SegGroup, SubLabel } from './parts';

/** What a crash report holds and never holds (plan 31): the Privacy page and its confirmation. */
export const CRASH_REPORTS_TEXT =
  "Off by default. When on, crashes and unexpected errors are sent to a crash-reporting service in the EU so they can be fixed. Reports contain the app version, device model and OS version, and the error. Before a report leaves the phone, the app removes your VIN, adapter name and address, and AI server address and key; a crash inside the phone's own system code is sent without that clean-up and could, rarely, include a Bluetooth adapter's address. Reports never contain trip data or location. You can turn this off any time.";

/** Settings → **Privacy** (plan 31, route `/settings-privacy`): the opt-in switch for anonymous crash
 *  reports. Off by default; switching on asks first. A build without a crash-service address (dev
 *  builds, forks) shows "Unavailable in this build" and keeps the switch disabled — nothing can be
 *  sent there. */
export function PrivacySettingsScreen() {
  const { t } = useTranslation('settings');
  useBackToSettings();
  const on = useSettingsStore((st) => st.crashReports);
  const setCrashReports = useSettingsStore((st) => st.setCrashReports);
  const available = isCrashReportingAvailable();

  // The guards matter: a disabled switch must never record consent.
  const turnOn = () => {
    if (on || !available) return;
    appAlert(t('privacy.confirmTitle'), t('privacy.crashText'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('privacy.turnOn'), onPress: () => setCrashReports(true) },
    ]);
  };

  return (
    <Screen title={t('privacy.title')}>
      <SegGroup>
        <YStack gap="$2" testID="settings-privacy">
          <SubLabel>{t('privacy.crashReports')}</SubLabel>
          {/* Switching on only asks (the switch stays off until Turn on); off applies at once. */}
          <LabeledSwitch
            label={t('privacy.helpFix')}
            accessibilityLabel={t('privacy.crashReports')}
            checked={on}
            disabled={!available}
            onCheckedChange={(next) => {
              if (next) turnOn();
              else if (available) setCrashReports(false);
            }}
            testID="settings-crash-reports"
          />
          <Paragraph theme="alt2" fontSize="$1">
            {t('privacy.crashText')}
          </Paragraph>
          {!available ? (
            <Paragraph theme="alt2" fontSize="$1" opacity={0.7} testID="crash-reports-unavailable">
              {t('privacy.unavailable')}
            </Paragraph>
          ) : null}
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            alignSelf="flex-start"
            accessibilityLabel={t('privacy.readPolicyA11y')}
            onPress={() =>
              Linking.openURL(PRIVACY_POLICY_URL).catch((e: unknown) =>
                logError({ source: 'settings/privacy', error: e, severity: 'warning' }),
              )
            }
          >
            {t('privacy.readPolicy')}
          </Button>
        </YStack>
      </SegGroup>
    </Screen>
  );
}
