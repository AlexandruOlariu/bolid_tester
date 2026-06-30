import React from 'react';
import { Alert } from 'react-native';
import { YStack, XStack, Card, Text, Paragraph, Button, Spinner } from 'tamagui';
import { Share2 } from 'lucide-react-native';
import { Screen, ValueCard } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { getVehicleProfile, vehicleLabel } from '@/shared/vehicles';
import { formatDtcReport, type DtcCheckReport } from '@/shared/lib/dtcReport';
import type { Dtc } from '@/shared/obd-core/obd/dtc';
import type { MonitorStatus } from '@/shared/obd-core/obd/readiness';
import type { FreezeFrame } from '@/shared/obd-core/session/DiagnosticSession';
import { useDtcs } from '../hooks/useDtcs';
import { useDtcExport } from '../hooks/useDtcExport';

function Section({ title, codes }: { title: string; codes: Dtc[] }) {
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$5">
        {title} ({codes.length})
      </Text>
      {codes.length === 0 ? (
        <Paragraph theme="alt2">None</Paragraph>
      ) : (
        codes.map((d) => (
          <Card key={`${title}-${d.code}`} bordered padding="$3">
            <Text fontWeight="800" color="$red10">
              {d.code}
            </Text>
            <Paragraph theme="alt2" fontSize="$2">
              {d.description}
            </Paragraph>
          </Card>
        ))
      )}
    </YStack>
  );
}

function ReadinessPanel({ readiness }: { readiness: MonitorStatus }) {
  const supported = readiness.monitors.filter((m) => m.supported);
  const complete = supported.filter((m) => m.complete).length;
  const notReady = supported.filter((m) => !m.complete);
  return (
    <Card bordered padding="$3" gap="$1">
      <XStack justifyContent="space-between" alignItems="center">
        <Text fontWeight="800">Readiness</Text>
        <Text fontWeight="800" color={readiness.milOn ? '$red10' : '$green10'}>
          MIL {readiness.milOn ? 'ON' : 'off'}
        </Text>
      </XStack>
      <Paragraph theme="alt2" fontSize="$2">
        {complete}/{supported.length} monitors complete · {readiness.ignition} ignition ·{' '}
        {readiness.dtcCount} DTC(s)
      </Paragraph>
      {notReady.length > 0 ? (
        <Paragraph theme="alt2" fontSize="$2">
          Not ready: {notReady.map((m) => m.name).join(', ')}
        </Paragraph>
      ) : null}
    </Card>
  );
}

function FreezeFrameView({ ff }: { ff: FreezeFrame }) {
  return (
    <YStack gap="$2">
      <Text fontWeight="800" fontSize="$5">
        Freeze frame
      </Text>
      <Paragraph theme="alt2" fontSize="$2">
        Captured when {ff.triggerDtc ?? 'a code'} set
      </Paragraph>
      <XStack flexWrap="wrap" gap="$2">
        {ff.values.map((v) => (
          <ValueCard key={v.pid} name={v.name} value={v.value} unit={v.unit} />
        ))}
      </XStack>
    </YStack>
  );
}

export function FaultCodesScreen() {
  const status = useSessionStore((s) => s.status);
  const info = useSessionStore((s) => s.info);
  const selectedProfileId = useVehicleStore((s) => s.selectedProfileId);
  const { stored, pending, permanent, readiness, freezeFrame, loading, error, refresh, clear } =
    useDtcs();
  const { exportReport, busy: exporting } = useDtcExport();

  const onExport = async () => {
    const profile = getVehicleProfile(selectedProfileId);
    const supported = readiness ? readiness.monitors.filter((m) => m.supported) : [];
    const check: DtcCheckReport = {
      ts: Date.now(),
      vehicleLabel: vehicleLabel(profile),
      vin: info?.vin ?? null,
      milOn: readiness ? readiness.milOn : null,
      stored,
      pending,
      permanent,
      monitorsComplete: readiness ? supported.filter((m) => m.complete).length : null,
      monitorsTotal: readiness ? supported.length : null,
      notReady: readiness ? supported.filter((m) => !m.complete).map((m) => m.name) : [],
      freezeFrame: freezeFrame
        ? {
            triggerDtc: freezeFrame.triggerDtc,
            values: freezeFrame.values.map((v) => ({ name: v.name, value: v.value, unit: v.unit })),
          }
        : null,
    };
    const body = formatDtcReport([check], { title: 'Bolid Tester — fault codes' });
    const uri = await exportReport('bolid-fault-codes', body);
    if (!uri) Alert.alert('Export unavailable', 'Sharing is not available on this device.');
  };

  const confirmClear = () =>
    Alert.alert(
      'Clear fault codes?',
      'This erases stored codes and resets readiness monitors. Codes will return if the fault persists.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => void clear() },
      ],
    );

  if (status !== 'connected') {
    return (
      <Screen title="Fault codes">
        <Paragraph theme="alt2">Not connected.</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title="Fault codes" onRefresh={refresh} refreshing={loading}>
      {error ? <Paragraph color="$red10">{error}</Paragraph> : null}
      {readiness ? <ReadinessPanel readiness={readiness} /> : null}
      <Section title="Stored" codes={stored} />
      <Section title="Pending" codes={pending} />
      <Section title="Permanent" codes={permanent} />
      {freezeFrame ? <FreezeFrameView ff={freezeFrame} /> : null}

      <XStack gap="$3" marginTop="$2">
        <Button flex={1} onPress={refresh} icon={loading ? () => <Spinner /> : undefined}>
          Re-read
        </Button>
        <Button flex={1} theme="red" onPress={confirmClear} disabled={loading}>
          Clear codes
        </Button>
      </XStack>
      <Button
        marginTop="$2"
        onPress={onExport}
        disabled={exporting}
        icon={exporting ? () => <Spinner /> : () => <Share2 size={18} color="#2bb673" />}
      >
        Export report
      </Button>
    </Screen>
  );
}
