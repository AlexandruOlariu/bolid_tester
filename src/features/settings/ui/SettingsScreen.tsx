import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ScrollView, YStack, XStack, Text, Paragraph, Button, Card, Input, Spinner } from 'tamagui';
import {
  Screen,
  appAlert,
  SegmentedControl,
  LabeledSwitch,
  HIT_SLOP,
  type SegmentOption,
} from '@/shared/ui';
import {
  useSettingsStore,
  parseDtcList,
  isAdapterSourceSupported,
  type AdapterSource,
} from '@/shared/state/settingsStore';
import {
  useAdapterLogStore,
  clearAdapterLogEntries,
  ADAPTER_LOG_CAPACITY,
} from '@/shared/state/adapterLog';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_PRESETS,
  normalizeBaseUrl,
  type AiProviderId,
} from '@/shared/obd-core';
import { getAiClient, AiClientError } from '@/shared/ai';
import { logError } from '@/shared/state/errorLogStore';
import { useLogFixtureExport } from '../hooks/useLogFixtureExport';
import { DEFAULT_FLOW_NAME, fixtureVehicleId } from '../model/replayExport';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { connectionService } from '@/features/connection';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import {
  APP_BUILD,
  APP_NAME,
  APP_VERSION,
  DOCS_URL,
  PRIVACY_POLICY_URL,
} from '@/shared/lib/appInfo';
import {
  crashReportingReady,
  isCrashReportingAvailable,
  sendTestCrashReport,
} from '@/shared/telemetry/crashReporting';
import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED } from '../model/privacyPolicy';
import { LabelPacksSection } from './LabelPacksSection';
import { SeedKeysSection } from './SeedKeysSection';
import {
  DEFAULT_WIFI_ENDPOINT,
  formatEndpoint,
  isValidHost,
  parseEndpoint,
} from '@/shared/transports/tcp/endpoint';
import { i18n, initI18n, useTranslation, type TFunction } from '@/shared/i18n';
import type { LanguagePref } from '@/shared/lib/i18nResolve';

/** A section heading (announced as a heading, plan 20) in the theme's accent colour. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontWeight="800"
      fontSize="$2"
      color="$accent"
      letterSpacing={0.8}
      textTransform="uppercase"
      role="heading"
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}

/** A heading inside a section (e.g. the parts of Developer & simulator). */
function SubLabel({ children }: { children: string }) {
  return (
    <Text fontWeight="700" fontSize="$3" role="heading" accessibilityRole="header">
      {children}
    </Text>
  );
}

function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <Card bordered padding="$3" backgroundColor="$backgroundHover">
      {children}
    </Card>
  );
}

function AiSection() {
  const { t } = useTranslation('settings');
  const ai = useSettingsStore((s) => s.ai);
  const setAi = useSettingsStore((s) => s.setAi);
  const [testing, setTesting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const preset = AI_PROVIDER_PRESETS[ai.provider] ?? AI_PROVIDER_PRESETS.local;
  const fixedUrl = !!preset.baseUrl;
  const anthropic = preset.wire === 'anthropic-messages';

  const switchProvider = (provider: AiProviderId) => {
    setStatusText(null);
    setAi({ provider });
  };

  const test = async (autofillModel: boolean) => {
    setTesting(true);
    setStatusText(t('ai.connecting'));
    // The owner may switch provider (or edit the address) while the request runs: its model list
    // and status then belong to settings no longer shown, so they are dropped, not applied.
    const stale = () => {
      const cur = useSettingsStore.getState().ai;
      if (cur.provider === ai.provider && cur.baseUrl === ai.baseUrl) return false;
      setStatusText(null);
      return true;
    };
    try {
      const models = await getAiClient(ai).listModels();
      if (stale()) return;
      if (models.length === 0) {
        setStatusText(t('ai.noModels'));
      } else {
        // A cloud list is long: keep a listed model there; a local server's first model is the loaded one.
        if (autofillModel && !(fixedUrl && models.includes(ai.model))) setAi({ model: models[0] });
        const shown = models.slice(0, 4).join(', ');
        setStatusText(
          t('ai.connected', {
            count: models.length,
            models: `${shown}${models.length > 4 ? '…' : ''}`,
          }),
        );
      }
    } catch (e) {
      if (stale()) return;
      setStatusText(
        t('ai.failed', {
          error: e instanceof AiClientError || e instanceof Error ? e.message : String(e),
        }),
      );
      logError({
        source: 'settings/ai-test',
        error: e,
        severity: 'warning',
        context: { provider: ai.provider, baseUrl: ai.baseUrl },
      });
    } finally {
      setTesting(false);
    }
  };

  const target = anthropic ? 'messages' : 'chat/completions';

  return (
    <YStack gap="$2">
      <SectionLabel>{t('ai.title')}</SectionLabel>
      <SegGroup>
        <YStack gap="$3">
          <LabeledSwitch
            label={t('ai.enabled')}
            accessibilityLabel={t('ai.enabledA11y')}
            checked={ai.enabled}
            onCheckedChange={(enabled) => setAi({ enabled })}
            testID="settings-ai-enabled"
          />

          <YStack gap="$1">
            <Paragraph theme="alt2" fontSize="$2">
              {t('ai.provider')}
            </Paragraph>
            <SegmentedControl
              label={t('ai.providerA11y')}
              options={AI_PROVIDER_IDS.map((id) => ({
                value: id,
                label: t(`ai.providerLabel.${id}`, { defaultValue: AI_PROVIDER_PRESETS[id].label }),
              }))}
              value={ai.provider}
              onChange={switchProvider}
            />
            <Paragraph theme="alt2" fontSize="$1">
              {t(`ai.providerHint.${ai.provider}`, { defaultValue: preset.hint })}
            </Paragraph>
          </YStack>

          <YStack gap="$1">
            <Paragraph theme="alt2" fontSize="$2">
              {fixedUrl ? t('ai.serverUrl') : t('ai.serverUrlCustom')}
            </Paragraph>
            {fixedUrl ? (
              <XStack gap="$2" alignItems="center">
                <Paragraph flex={1} fontSize="$3" testID="ai-fixed-url">
                  {ai.baseUrl}
                </Paragraph>
                <Button
                  size="$3"
                  hitSlop={HIT_SLOP}
                  chromeless
                  accessibilityLabel={t('ai.editUrlA11y')}
                  onPress={() =>
                    setAi({ provider: 'custom', baseUrl: ai.baseUrl, model: ai.model })
                  }
                >
                  {t('ai.edit')}
                </Button>
              </XStack>
            ) : (
              <Input
                value={ai.baseUrl}
                onChangeText={(text) => setAi({ baseUrl: text })}
                placeholder="http://192.168.1.50:1234"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel={t('ai.serverUrlA11y')}
              />
            )}
            {ai.baseUrl ? (
              <Paragraph theme="alt2" fontSize="$1">
                → {normalizeBaseUrl(ai.baseUrl)}/{target}
              </Paragraph>
            ) : null}
          </YStack>

          {ai.provider !== 'local' ? (
            <YStack gap="$1">
              <Paragraph theme="alt2" fontSize="$2">
                {preset.needsKey ? t('ai.apiKey') : t('ai.apiKeyOptional')}
              </Paragraph>
              <Input
                value={ai.apiKey}
                onChangeText={(text) => setAi({ apiKey: text.trim() })}
                placeholder={preset.needsKey ? t('ai.apiKeyPlaceholder') : t('ai.apiKeyIfAsked')}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t('ai.apiKeyA11y', {
                  provider: t(`ai.providerLabel.${ai.provider}`, { defaultValue: preset.label }),
                })}
              />
              {Platform.OS === 'web' ? (
                // Web (plan 28): there is no keystore in the browser, so the key is memory-only.
                <Paragraph theme="alt2" fontSize="$1" testID="settings-ai-key-web">
                  {t('ai.keyWeb')}
                </Paragraph>
              ) : (
                <Paragraph theme="alt2" fontSize="$1">
                  {t('ai.keyStored')}
                </Paragraph>
              )}
            </YStack>
          ) : null}

          <YStack gap="$1">
            <Paragraph theme="alt2" fontSize="$2">
              {t('ai.model')}
            </Paragraph>
            <Input
              value={ai.model}
              onChangeText={(text) => setAi({ model: text })}
              placeholder={preset.defaultModel || t('ai.modelPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t('ai.modelA11y')}
            />
          </YStack>

          {anthropic ? null : (
            <YStack gap="$1" testID="ai-structured-output">
              <Paragraph>{t('ai.structured')}</Paragraph>
              <SegmentedControl
                label={t('ai.structured')}
                options={jsonModeOptions(t)}
                value={ai.jsonMode}
                onChange={(jsonMode) => setAi({ jsonMode })}
              />
              <Paragraph theme="alt2" fontSize="$1">
                {t('ai.structuredHelp')}
              </Paragraph>
            </YStack>
          )}

          <YStack gap="$1">
            <Paragraph>{t('ai.timeout')}</Paragraph>
            <SegmentedControl
              label={t('ai.timeoutA11y')}
              options={timeoutOptions(t)}
              value={ai.timeoutMs}
              onChange={(timeoutMs) => setAi({ timeoutMs })}
            />
          </YStack>

          <XStack gap="$2">
            <Button
              flex={1}
              onPress={() => void test(false)}
              disabled={testing}
              icon={testing ? () => <Spinner /> : undefined}
            >
              {t('ai.test')}
            </Button>
            <Button flex={1} theme="green" onPress={() => void test(true)} disabled={testing}>
              {t('ai.detect')}
            </Button>
          </XStack>
          {statusText ? (
            <Paragraph theme="alt2" fontSize="$2">
              {statusText}
            </Paragraph>
          ) : null}
        </YStack>
      </SegGroup>
    </YStack>
  );
}

const jsonModeOptions = (t: TFunction): SegmentOption<'schema' | 'object' | 'off'>[] => [
  { value: 'schema', label: t('ai.jsonSchema') },
  { value: 'object', label: 'JSON' },
  { value: 'off', label: t('ai.jsonOff'), accessibilityLabel: t('ai.jsonOffA11y') },
];

const timeoutOptions = (t: TFunction): SegmentOption<number>[] =>
  [15000, 30000, 60000].map((ms) => ({
    value: ms,
    label: `${ms / 1000}s`,
    accessibilityLabel: t('seconds', { count: ms / 1000 }),
  }));

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

/** The value of the Custom… option in the injected-DTC row. */
const CUSTOM_DTCS = 'custom';

const DTC_PRESETS: { label: string; codes: string[] }[] = [
  { label: 'none', codes: [] },
  { label: 'P0299', codes: ['P0299'] },
  { label: 'P0299+P0401', codes: ['P0299', 'P0401'] },
];

/** Simulator fault injection: three presets plus **Custom…**, a free-text list of codes
 *  (comma-separated, each `[PCBU]` + 4 hex digits; invalid entries are ignored). */
function InjectedDtcsSection() {
  const { t } = useTranslation('settings');
  const injected = useSettingsStore((st) => st.injectedDtcs);
  const setInjectedDtcs = useSettingsStore((st) => st.setInjectedDtcs);
  const matchesPreset = DTC_PRESETS.some((p) => p.codes.join() === injected.join());
  const [customOpen, setCustomOpen] = useState(!matchesPreset);
  const [customText, setCustomText] = useState(matchesPreset ? '' : injected.join(', '));

  const pickPreset = (codes: string[]) => {
    setCustomOpen(false);
    setInjectedDtcs(codes);
  };
  const editCustom = (text: string) => {
    setCustomText(text);
    setInjectedDtcs(parseDtcList(text));
  };

  return (
    <YStack gap="$2">
      <SubLabel>{t('dev.injected')}</SubLabel>
      <YStack>
        <YStack gap="$2">
          <SegmentedControl
            label={t('dev.injectedA11y')}
            options={[
              ...DTC_PRESETS.map((p) => ({
                value: p.label,
                label: p.label === 'none' ? t('dev.none') : p.label,
              })),
              {
                value: CUSTOM_DTCS,
                label: t('dev.custom'),
                accessibilityLabel: t('dev.customA11y'),
              },
            ]}
            value={
              customOpen
                ? CUSTOM_DTCS
                : (DTC_PRESETS.find((p) => p.codes.join() === injected.join())?.label ?? null)
            }
            onChange={(v) => {
              const preset = DTC_PRESETS.find((p) => p.label === v);
              if (preset) {
                pickPreset(preset.codes);
                return;
              }
              setCustomOpen(true);
              setInjectedDtcs(parseDtcList(customText));
            }}
          />
          {customOpen ? (
            <YStack gap="$1">
              <Input
                value={customText}
                onChangeText={editCustom}
                placeholder={t('dev.customPlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel={t('dev.customInputA11y')}
              />
              <Paragraph theme="alt2" fontSize="$1">
                {injected.length > 0
                  ? t('dev.injecting', { codes: injected.join(', ') })
                  : t('dev.customHelp')}
              </Paragraph>
            </YStack>
          ) : null}
        </YStack>
      </YStack>
    </YStack>
  );
}

/** Simulator-only test controls for the link-robustness paths (plan 12): drop the live simulated
 *  link (auto-reconnect + flap guard), or make the next simulator connect get no reply to `ATZ`
 *  (the Connect screen's diagnostics panel, stage "Adapter start-up"). */
function SimulatorDeveloperSection() {
  const { t } = useTranslation('settings');
  const status = useSessionStore((st) => st.status);
  const [note, setNote] = useState<string | null>(null);

  const drop = () => {
    const dropped = connectionService.__sim.simulateDrop();
    setNote(dropped ? t('dev.dropped') : t('dev.connectSimFirst'));
  };
  const failNext = () => {
    connectionService.__sim.failNextConnect();
    setNote(t('dev.armed'));
  };

  return (
    <YStack gap="$2">
      <SubLabel>{t('dev.simControls')}</SubLabel>
      <YStack>
        <YStack gap="$2">
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$3" hitSlop={HIT_SLOP} disabled={status !== 'connected'} onPress={drop}>
              {t('dev.simulateDrop')}
            </Button>
            <Button size="$3" hitSlop={HIT_SLOP} onPress={failNext}>
              {t('dev.failNext')}
            </Button>
          </XStack>
          <Paragraph theme="alt2" fontSize="$1">
            {note ?? t('dev.simControlsHelp')}
          </Paragraph>
        </YStack>
      </YStack>
    </YStack>
  );
}

/** Settings → About (plan 08, plan 07): the app version (= the OTA runtime version), the build when
 *  `app.json` carries one, the privacy policy (its text lives in `model/privacyPolicy.ts` and is
 *  published as docs/privacy-policy.md) and a link to the documentation. */
function AboutSection() {
  const { t } = useTranslation('settings');
  const [policyOpen, setPolicyOpen] = useState(false);

  return (
    <YStack gap="$2">
      <SectionLabel>{t('about.title')}</SectionLabel>
      <SegGroup>
        <YStack gap="$2">
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
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            onPress={() => setPolicyOpen((open) => !open)}
            accessibilityLabel={policyOpen ? t('about.hidePolicyA11y') : t('about.showPolicyA11y')}
          >
            {policyOpen ? t('about.hidePolicy') : t('about.policy')}
          </Button>
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            accessibilityLabel={t('about.docsA11y')}
            onPress={() =>
              Linking.openURL(DOCS_URL).catch((e: unknown) =>
                logError({ source: 'settings/about', error: e, severity: 'warning' }),
              )
            }
          >
            {t('about.docs')}
          </Button>
          {policyOpen ? (
            <YStack gap="$2">
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
          ) : null}
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** **Data** (plan 18): the way to the Backup & restore screen — one file with every store and the
 *  trip recordings, restore from such a file, and per-store JSON / CSV export; then the label packs
 *  (plan 13: import, imported packs, bundled packs as templates) and the security-access plugins
 *  (plan 23: import, installed plugins, test in simulator). */
function DataSection() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  return (
    <YStack gap="$2">
      <SectionLabel>{t('data.title')}</SectionLabel>
      <SegGroup>
        <YStack gap="$2">
          <Paragraph fontSize="$2">{t('data.help')}</Paragraph>
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$3" hitSlop={HIT_SLOP} onPress={() => router.push('/backup')}>
              {t('data.backup')}
            </Button>
            <Button size="$3" hitSlop={HIT_SLOP} onPress={() => router.push('/backup')}>
              {t('data.export')}
            </Button>
          </XStack>
          <LabelPacksSection />
          <SeedKeysSection />
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** Warning for an adapter log that wrapped: the export would start mid-session. */
function wrappedText(t: TFunction, dropped: number): string {
  return t('log.wrapped', { count: dropped });
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
          <Paragraph theme="alt2" fontSize="$1">
            {t('general.units')}
          </Paragraph>
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** What a crash report holds and never holds (plan 31): the Privacy section and its confirmation. */
export const CRASH_REPORTS_TEXT =
  "Off by default. When on, crashes and unexpected errors are sent to a crash-reporting service in the EU so they can be fixed. Reports contain the app version, device model and OS version, and the error. Before a report leaves the phone, the app removes your VIN, adapter name and address, and AI server address and key; a crash inside the phone's own system code is sent without that clean-up and could, rarely, include a Bluetooth adapter's address. Reports never contain trip data or location. You can turn this off any time.";

/** **Privacy** (plan 31): the opt-in switch for anonymous crash reports. Off by default; switching
 *  on asks first. A build without a crash-service address (dev builds, forks) shows "Unavailable in
 *  this build" and keeps the switch disabled — nothing can be sent there. */
function PrivacySection() {
  const { t } = useTranslation('settings');
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
    <YStack gap="$2">
      <SectionLabel>{t('privacy.title')}</SectionLabel>
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
    </YStack>
  );
}

/** Developer & simulator → **Send test crash report** (plan 31): hands the crash service one event
 *  carrying a sample VIN, adapter address and server address, so the received report shows the
 *  scrubbing (`***03398`, `<device-id>`, `<url>`). Disabled while reporting is off. */
function TestCrashReportSection() {
  const { t } = useTranslation('settings');
  const on = useSettingsStore((st) => st.crashReports);
  const usable = on && isCrashReportingAvailable();
  const send = async () => {
    await crashReportingReady();
    appAlert(
      t('dev.testCrashTitle'),
      sendTestCrashReport() ? t('dev.testCrashSent') : t('dev.testCrashNotSent'),
    );
  };
  return (
    <YStack gap="$2">
      <SubLabel>{t('dev.crashReports')}</SubLabel>
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        alignSelf="flex-start"
        disabled={!usable}
        opacity={usable ? 1 : 0.5}
        onPress={() => {
          if (usable) void send();
        }}
      >
        {t('dev.testCrash')}
      </Button>
      <Paragraph theme="alt2" fontSize="$1">
        {usable ? t('dev.testCrashHelp') : t('dev.testCrashOff')}
      </Paragraph>
    </YStack>
  );
}

/** **Connection**: auto-reconnect, the poll interval and VIN recognition of garage cars. */
function ConnectionSection() {
  const { t } = useTranslation('settings');
  const s = useSettingsStore();
  return (
    <YStack gap="$2">
      <SectionLabel>{t('connection.title')}</SectionLabel>
      <SegGroup>
        <YStack gap="$4">
          <YStack gap="$2">
            <SubLabel>{t('connection.autoReconnect')}</SubLabel>
            <LabeledSwitch
              label={t('connection.autoReconnectLabel')}
              accessibilityLabel={t('connection.autoReconnect')}
              checked={s.autoReconnect}
              onCheckedChange={s.setAutoReconnect}
              testID="settings-auto-reconnect"
            />
            <Paragraph theme="alt2" fontSize="$1">
              {t('connection.autoReconnectHelp')}
            </Paragraph>
          </YStack>

          <YStack gap="$2">
            <SubLabel>{t('connection.poll')}</SubLabel>
            <SegmentedControl
              label={t('connection.poll')}
              options={pollOptions(t)}
              value={s.pollIntervalMs}
              onChange={s.setPollInterval}
            />
            <Paragraph theme="alt2" fontSize="$1">
              {t('connection.pollHelp')}
            </Paragraph>
          </YStack>

          <YStack gap="$2">
            <SubLabel>{t('connection.byVin')}</SubLabel>
            <LabeledSwitch
              label={t('connection.byVinLabel')}
              accessibilityLabel={t('connection.byVin')}
              checked={s.autoSelectByVin}
              onCheckedChange={s.setAutoSelectByVin}
              testID="settings-auto-select-vin"
            />
            <Paragraph theme="alt2" fontSize="$1">
              {t('connection.byVinHelp')}
            </Paragraph>
          </YStack>
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** **Notifications**: the preferences live on their own screen. */
function NotificationsSection() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  return (
    <YStack gap="$2">
      <SectionLabel>{t('notifications.title')}</SectionLabel>
      <XStack
        alignItems="center"
        gap="$3"
        padding="$3"
        backgroundColor="$backgroundHover"
        borderRadius="$4"
        borderWidth={1}
        borderColor="$borderColor"
        pressStyle={{ backgroundColor: '$color4' }}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${t('notifications.row')}. ${t('notifications.rowHelp')}`}
        onPress={() => router.push('/notifications')}
      >
        <YStack flex={1}>
          <Paragraph fontWeight="700">{t('notifications.row')}</Paragraph>
          <Paragraph theme="alt2" fontSize="$2">
            {t('notifications.rowHelp')}
          </Paragraph>
        </YStack>
        <Paragraph theme="alt2" accessibilityElementsHidden importantForAccessibility="no">
          ›
        </Paragraph>
      </XStack>
    </YStack>
  );
}

/** The adapter I/O log with **Clear** and **Export as replay fixture** (plan 02). */
function AdapterLogSection() {
  const { t } = useTranslation('settings');
  const { exportFixture, busy: exportingFixture } = useLogFixtureExport();
  const adapterSource = useSettingsStore((st) => st.adapterSource);
  const simulatedVehicle = useSettingsStore((st) => st.simulatedVehicleId);
  const log = useAdapterLogStore((st) => st.entries);
  const logDropped = useAdapterLogStore((st) => st.dropped);
  const logOrigin = useAdapterLogStore((st) => st.origin);
  const info = useSessionStore((st) => st.info);
  const selectedProfileId = useVehicleStore((st) => st.selectedProfileId);
  const garage = useGarageStore((st) => st.vehicles);
  const [flowName, setFlowName] = useState(DEFAULT_FLOW_NAME);
  // The outcome of the last export, with the log's `dropped` count at that moment. It gives way to
  // the default hint on Clear, and to the "log is full" warning as soon as the log wraps further,
  // so a stale "Saved …" never hides that warning for the next flow.
  const [exportStatus, setExportStatus] = useState<{ text: string; dropped: number } | null>(null);
  const monoFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

  // A simulator session is labelled as such (and with the simulated car), so it can never pass for
  // an on-car validation fixture. The label comes from how the log was recorded (its `origin`,
  // stamped by the connect that produced it, plan W2) — not from the settings at export time, which
  // may have changed since (a disconnect, another simulated car). Clear keeps the origin. Only a
  // log no connect stamped (traffic logged after a source switch reset it — which the service
  // never does) falls back to the current settings and session.
  const onExportFixture = async () => {
    const simulator = logOrigin ? logOrigin.source === 'simulator' : adapterSource === 'mock';
    const simulatedVehicleId = logOrigin?.simulatedVehicleId ?? simulatedVehicle;
    const saved = await exportFixture({
      log,
      flow: flowName,
      vehicleId: fixtureVehicleId({ simulator, simulatedVehicleId, selectedProfileId }, garage),
      source: simulator ? 'simulator' : 'car',
      adapter: logOrigin?.adapter ?? info?.version,
      protocol: logOrigin?.protocol ?? info?.protocol,
      droppedEntries: logDropped,
      appVersion: APP_VERSION,
    });
    setExportStatus({
      dropped: logDropped,
      text: !saved
        ? t('log.saveFailed')
        : logDropped > 0
          ? t('log.savedFull', { file: saved, wrapped: wrappedText(t, logDropped) })
          : t('log.saved', { file: saved }),
    });
  };
  const onClearLog = () => {
    // Entries only: the origin stays, so the next flow recorded on the live session (or the next
    // connect, which re-stamps it) is still labelled by the session that produced it.
    clearAdapterLogEntries();
    setExportStatus(null);
  };

  return (
    <YStack gap="$2">
      <XStack justifyContent="space-between" alignItems="center">
        <SubLabel>{t('log.title')}</SubLabel>
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          onPress={onClearLog}
          accessibilityLabel={t('log.clearA11y')}
        >
          {t('log.clear')}
        </Button>
      </XStack>
      <XStack gap="$2" alignItems="center">
        <Input
          flex={1}
          size="$3"
          value={flowName}
          onChangeText={setFlowName}
          placeholder={DEFAULT_FLOW_NAME}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('log.flowName')}
        />
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          disabled={exportingFixture || log.length === 0}
          onPress={() => void onExportFixture()}
        >
          {t('log.export')}
        </Button>
      </XStack>
      <Paragraph theme="alt2" fontSize="$1">
        {exportStatus && logDropped <= exportStatus.dropped
          ? exportStatus.text
          : logDropped > 0
            ? t('log.full', { wrapped: wrappedText(t, logDropped) })
            : t('log.help', { capacity: ADAPTER_LOG_CAPACITY })}
      </Paragraph>
      <Card bordered padding="$2" height={220} backgroundColor="$backgroundStrong">
        <ScrollView>
          {log
            .slice(-60)
            .reverse()
            .map((e, i) => (
              <Text
                key={i}
                fontSize="$1"
                fontFamily={monoFont}
                color={e.dir === 'tx' ? '$statusInfo' : '$statusOk'}
                numberOfLines={1}
              >
                {e.dir === 'tx' ? '» ' : '« '}
                {e.text.replace(/\s+/g, ' ').trim()}
              </Text>
            ))}
          {log.length === 0 ? (
            <Paragraph theme="alt2" fontSize="$2">
              {t('log.empty')}
            </Paragraph>
          ) : null}
        </ScrollView>
      </Card>
    </YStack>
  );
}

/** What **Reset all app data** runs: the backup slice's `resetAllAppData`, handed in by the route
 *  (`src/app/settings.tsx`) because no feature imports the backup slice. Resolves with the problems
 *  it hit (plain English, each also logged). */
export type ResetAppData = () => Promise<{ problems: string[] }>;

/** **Show hints again** and **Reset all app data** (plan 07), at the end of Developer & simulator.
 *  Without a `resetAppData` action the reset button is not shown. */
function HintsAndResetSection({ resetAppData }: { resetAppData?: ResetAppData }) {
  const { t } = useTranslation('settings');
  const [note, setNote] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const showHints = () => {
    useOnboardingStore.getState().reset();
    setNote(t('reset.hintsBack'));
  };

  const runReset = async () => {
    if (!resetAppData) return;
    setResetting(true);
    try {
      // The restore teardown, not a plain disconnect: it also invalidates a connect still in flight
      // (scan / handshake), so no session built for the old adapter source is published after the
      // reset puts the setting back to the real adapter, and a failing close is logged, not fatal.
      await connectionService.resetForRestore();
      const outcome = await resetAppData();
      setNote(
        outcome.problems.length === 0
          ? t('reset.done')
          : t('reset.doneWithProblems', { problems: outcome.problems.join(' ') }),
      );
    } catch (e) {
      logError({ source: 'settings/reset', error: e });
      setNote(t('reset.failed'));
    } finally {
      setResetting(false);
    }
  };

  const confirmReset = () => {
    appAlert(t('reset.confirmTitle'), t('reset.confirmBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('reset.continue'),
        style: 'destructive',
        onPress: () =>
          appAlert(t('reset.confirm2Title'), t('reset.confirm2Body'), [
            { text: t('common:actions.cancel'), style: 'cancel' },
            { text: t('reset.everything'), style: 'destructive', onPress: () => void runReset() },
          ]),
      },
    ]);
  };

  return (
    <YStack gap="$2">
      <SubLabel>{t('reset.title')}</SubLabel>
      <XStack gap="$2" flexWrap="wrap">
        <Button size="$3" hitSlop={HIT_SLOP} onPress={showHints}>
          {t('reset.showHints')}
        </Button>
        {resetAppData ? (
          <Button
            size="$3"
            hitSlop={HIT_SLOP}
            theme="red"
            disabled={resetting}
            icon={resetting ? () => <Spinner /> : undefined}
            onPress={confirmReset}
          >
            {t('reset.resetAll')}
          </Button>
        ) : null}
      </XStack>
      <Paragraph theme="alt2" fontSize="$1">
        {note ?? t('reset.help')}
      </Paragraph>
    </YStack>
  );
}

/** The adapter-source options; Wi-Fi and classic Bluetooth only where the platform supports them. */
const adapterSourceOptions = (t: TFunction): SegmentOption<AdapterSource>[] => [
  { value: 'ble', label: t('dev.source.ble') },
  { value: 'wifi', label: t('dev.source.wifi') },
  { value: 'spp', label: t('dev.source.spp') },
  { value: 'mock', label: t('dev.source.mock') },
];

/** The Wi-Fi adapter's address (plan 26), shown under the adapter-source segment while Wi-Fi is
 *  selected. Host and port are edited as text; a valid pair is saved at once, an invalid one shows
 *  why and leaves the saved address untouched. */
function WifiEndpointSection() {
  const { t } = useTranslation('settings');
  const wifi = useSettingsStore((st) => st.wifi);
  const setWifi = useSettingsStore((st) => st.setWifi);
  const [host, setHost] = useState(wifi.host);
  const [port, setPort] = useState(String(wifi.port));
  // The address these fields last showed or saved. When the stored address changes from elsewhere
  // (a data restore, another setWifi caller) the fields follow it instead of keeping stale text —
  // otherwise the next keystroke would pair with the stale other field and overwrite the restore.
  const shown = useRef(formatEndpoint(wifi));
  useEffect(() => {
    const stored = formatEndpoint(wifi);
    if (stored === shown.current) return;
    shown.current = stored;
    setHost(wifi.host);
    setPort(String(wifi.port));
  }, [wifi]);

  const parsed = parseEndpoint(`${host.trim()}:${port.trim()}`);
  const problem = parsed ? null : !isValidHost(host.trim()) ? t('wifi.badHost') : t('wifi.badPort');

  const edit = (nextHost: string, nextPort: string) => {
    setHost(nextHost);
    setPort(nextPort);
    const ep = parseEndpoint(`${nextHost.trim()}:${nextPort.trim()}`);
    if (ep) {
      shown.current = formatEndpoint(ep);
      setWifi(ep);
    }
  };

  return (
    <YStack gap="$2" testID="settings-wifi">
      <SubLabel>{t('wifi.title')}</SubLabel>
      <XStack gap="$2" alignItems="center">
        <Input
          flex={3}
          value={host}
          onChangeText={(t) => edit(t, port)}
          placeholder={DEFAULT_WIFI_ENDPOINT.host}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel={t('wifi.hostA11y')}
        />
        <Input
          flex={2}
          value={port}
          onChangeText={(t) => edit(host, t)}
          placeholder={String(DEFAULT_WIFI_ENDPOINT.port)}
          keyboardType="number-pad"
          accessibilityLabel={t('wifi.portA11y')}
        />
      </XStack>
      {problem ? (
        <Paragraph color="$statusError" fontSize="$2" testID="settings-wifi-error">
          {problem} {t('wifi.keepsUsing', { endpoint: formatEndpoint(wifi) })}
        </Paragraph>
      ) : null}
      <Paragraph theme="alt2" fontSize="$1">
        {t('wifi.help', { endpoint: formatEndpoint(DEFAULT_WIFI_ENDPOINT) })}
      </Paragraph>
      {formatEndpoint(wifi) !== formatEndpoint(DEFAULT_WIFI_ENDPOINT) ? (
        <Button
          size="$3"
          hitSlop={HIT_SLOP}
          alignSelf="flex-start"
          onPress={() => edit(DEFAULT_WIFI_ENDPOINT.host, String(DEFAULT_WIFI_ENDPOINT.port))}
        >
          {t('wifi.useDefault')}
        </Button>
      ) : null}
    </YStack>
  );
}

/** **Developer & simulator** (plan 07): collapsed by default. The adapter source, the simulated
 *  car, injected codes and link tests, the adapter log with the replay-fixture export, and the
 *  hints / reset controls. The simulator banner (plan 01) stays the always-on indicator. */
function DeveloperSection({ resetAppData }: { resetAppData?: ResetAppData }) {
  const { t } = useTranslation('settings');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const s = useSettingsStore();
  const garage = useGarageStore((st) => st.vehicles);

  return (
    <YStack gap="$2">
      <XStack
        justifyContent="space-between"
        alignItems="center"
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${t('dev.title')}. ${open ? t('dev.hide') : t('dev.show')}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
      >
        <SectionLabel>{t('dev.title')}</SectionLabel>
        <Text fontWeight="700" fontSize="$3" color="$accent">
          {open ? t('dev.hide') : t('dev.show')}
        </Text>
      </XStack>
      {!open ? (
        <Paragraph theme="alt2" fontSize="$1">
          {t('dev.summary')}
        </Paragraph>
      ) : (
        <SegGroup>
          <YStack gap="$4" testID="settings-developer">
            <YStack gap="$2">
              <SubLabel>{t('dev.adapterSource')}</SubLabel>
              {/* A browser cannot open a TCP socket to a Wi-Fi adapter (plan 28). Classic Bluetooth
                  (plan 27) is Android only: iOS opens classic accessories only through MFi, which
                  ELM327 clones are not. */}
              <SegmentedControl
                label={t('dev.adapterSource')}
                options={adapterSourceOptions(t).filter((o) =>
                  isAdapterSourceSupported(o.value, Platform.OS),
                )}
                value={s.adapterSource}
                onChange={(source) => void connectionService.switchAdapterSource(source)}
              />
              <Paragraph theme="alt2" fontSize="$1">
                {Platform.OS === 'web'
                  ? t('dev.sourceHelpWeb')
                  : Platform.OS === 'android'
                    ? t('dev.sourceHelpAndroid')
                    : t('dev.sourceHelp')}
              </Paragraph>
            </YStack>

            {s.adapterSource === 'spp' ? (
              <Paragraph theme="alt2" fontSize="$1" testID="settings-spp">
                {t('dev.sppHelp')}
              </Paragraph>
            ) : null}

            {s.adapterSource === 'wifi' ? <WifiEndpointSection /> : null}

            {s.adapterSource === 'mock' ? (
              <>
                <YStack gap="$2">
                  <SubLabel>{t('dev.simVehicle')}</SubLabel>
                  <SegmentedControl
                    label={t('dev.simVehicle')}
                    options={[
                      ...VEHICLE_PROFILES.map((p) => ({
                        value: p.id,
                        label: p.id,
                        accessibilityLabel: p.name,
                      })),
                      ...garage.map((v) => ({ value: v.id, label: v.name })),
                    ]}
                    value={s.simulatedVehicleId}
                    onChange={s.setSimulatedVehicle}
                  />
                  {garage.length > 0 ? (
                    <Paragraph theme="alt2" fontSize="$1">
                      {t('dev.simGarage')}
                    </Paragraph>
                  ) : null}
                </YStack>

                <InjectedDtcsSection />

                <SimulatorDeveloperSection />
              </>
            ) : null}

            <AdapterLogSection />

            {/* Plan 32: opens Report a problem with the bundle already built, so its size shows. */}
            <YStack gap="$2">
              <SubLabel>{t('dev.problemReport')}</SubLabel>
              <Button
                size="$3"
                hitSlop={HIT_SLOP}
                alignSelf="flex-start"
                onPress={() => router.push({ pathname: '/feedback', params: { preview: '1' } })}
              >
                {t('dev.previewBundle')}
              </Button>
              <Paragraph theme="alt2" fontSize="$1">
                {t('dev.previewBundleHelp', { capacity: ADAPTER_LOG_CAPACITY })}
              </Paragraph>
            </YStack>

            <TestCrashReportSection />

            <HintsAndResetSection resetAppData={resetAppData} />
          </YStack>
        </SegGroup>
      )}
    </YStack>
  );
}

/** `resetAppData` is the **Reset all app data** action; the route passes the backup slice's
 *  `resetAllAppData` (features never import each other). */
export function SettingsScreen({ resetAppData }: { resetAppData?: ResetAppData } = {}) {
  const { t } = useTranslation('settings');
  const status = useSessionStore((st) => st.status);

  return (
    <Screen title={t('title')}>
      <GeneralSection />

      <ConnectionSection />

      <PrivacySection />

      <AiSection />

      <NotificationsSection />

      <DataSection />

      <DeveloperSection resetAppData={resetAppData} />

      <AboutSection />

      {status === 'connected' ? (
        <Button theme="red" onPress={() => connectionService.disconnect()}>
          {t('disconnect')}
        </Button>
      ) : null}
    </Screen>
  );
}
