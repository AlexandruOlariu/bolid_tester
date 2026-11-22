import React, { useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { YStack, XStack, Paragraph, Button, Input, Spinner } from 'tamagui';
import { Screen, appAlert, SegmentedControl, HIT_SLOP, type SegmentOption } from '@/shared/ui';
import {
  useSettingsStore,
  parseDtcList,
  isAdapterSourceSupported,
  type AdapterSource,
} from '@/shared/state/settingsStore';
import { ADAPTER_LOG_CAPACITY } from '@/shared/state/adapterLog';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useOnboardingStore } from '@/shared/state/onboardingStore';
import { logError } from '@/shared/state/errorLogStore';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { connectionService } from '@/features/connection';
import {
  crashReportingReady,
  isCrashReportingAvailable,
  sendTestCrashReport,
} from '@/shared/telemetry/crashReporting';
import { useTranslation, type TFunction } from '@/shared/i18n';
import { useBackToSettings } from '../hooks/useBackToSettings';
import { AdapterLogSection } from './AdapterLogSection';
import { WifiEndpointSection } from './WifiEndpointSection';
import { SegGroup, SubLabel } from './parts';

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

/** What **Reset all app data** runs: the backup slice's `resetAllAppData`, handed in by the route
 *  (`src/app/settings-developer.tsx`) because no feature imports the backup slice. Resolves with the problems
 *  it hit (plain English, each also logged). */
export type ResetAppData = () => Promise<{ problems: string[] }>;

/** **Show hints again** and **Reset all app data** (plan 07), at the end of the
 *  Developer & simulator page.
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

/** Settings → **Developer & simulator** (plan 07, route `/settings-developer`): the adapter source,
 *  the simulated car, injected codes and link tests, the adapter log with the replay-fixture
 *  export, the feedback-bundle preview, the test crash report and the hints / reset controls. The
 *  simulator banner (plan 01) stays the always-on indicator. `resetAppData` is the **Reset all app
 *  data** action; the route passes the backup slice's `resetAllAppData` (features never import each
 *  other). */
export function DeveloperSettingsScreen({ resetAppData }: { resetAppData?: ResetAppData } = {}) {
  const { t } = useTranslation('settings');
  useBackToSettings();
  const router = useRouter();
  const s = useSettingsStore();
  const garage = useGarageStore((st) => st.vehicles);

  return (
    <Screen title={t('dev.title')}>
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
    </Screen>
  );
}
