import React, { useState } from 'react';
import { Platform } from 'react-native';
import { ScrollView, YStack, XStack, Text, Paragraph, Button, Card, Input } from 'tamagui';
import { HIT_SLOP } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import {
  useAdapterLogStore,
  clearAdapterLogEntries,
  ADAPTER_LOG_CAPACITY,
} from '@/shared/state/adapterLog';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { useVehicleStore } from '@/shared/state/vehicleStore';
import { APP_VERSION } from '@/shared/lib/appInfo';
import { useTranslation, type TFunction } from '@/shared/i18n';
import { useLogFixtureExport } from '../hooks/useLogFixtureExport';
import { DEFAULT_FLOW_NAME, fixtureVehicleId } from '../model/replayExport';
import { SubLabel } from './parts';

/** Warning for an adapter log that wrapped: the export would start mid-session. */
function wrappedText(t: TFunction, dropped: number): string {
  return t('log.wrapped', { count: dropped });
}

/** The adapter I/O log with **Clear** and **Export as replay fixture** (plan 02). */
export function AdapterLogSection() {
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
