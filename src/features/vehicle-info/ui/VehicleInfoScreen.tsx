import React from 'react';
import { useRouter } from 'expo-router';
import { YStack, XStack, Card, Text, Paragraph, Separator, Button } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useVehicleInfo } from '../hooks/useVehicleInfo';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack justifyContent="space-between" paddingVertical="$1.5">
      <Paragraph theme="alt2">{label}</Paragraph>
      <Text fontWeight="700">{value}</Text>
    </XStack>
  );
}

export function VehicleInfoScreen() {
  const router = useRouter();
  const status = useSessionStore((s) => s.status);
  const { info, deviceName, protocolLabel } = useVehicleInfo();

  if (status !== 'connected' || !info) {
    return (
      <Screen title="Vehicle info">
        <Paragraph theme="alt2">Not connected.</Paragraph>
      </Screen>
    );
  }

  return (
    <Screen title="Vehicle info">
      <Card bordered padding="$3">
        <Row label="VIN" value={info.vin ?? 'not available'} />
        <Separator />
        <Row label="Calibration ID" value={info.calibrationId ?? 'not available'} />
        <Separator />
        <Row label="Protocol" value={protocolLabel} />
        <Separator />
        <Row label="Adapter" value={deviceName ?? '—'} />
        <Separator />
        <Row label="ELM version" value={info.version || '—'} />
        <Separator />
        <Row label="Voltage" value={info.voltage != null ? `${info.voltage.toFixed(1)} V` : '—'} />
        <Separator />
        <Row label="Supported PIDs" value={String(info.supportedPids.length)} />
      </Card>

      <YStack gap="$1">
        <Text fontWeight="700">Supported Mode 01 PIDs</Text>
        <Paragraph theme="alt2" fontSize="$2">
          {info.supportedPids.join('  ')}
        </Paragraph>
      </YStack>

      <Button theme="blue" onPress={() => router.push('/extended')}>
        Extended PIDs (experimental)
      </Button>

      <Button theme="blue" onPress={() => router.push('/vin-decode')}>
        Decode VIN
      </Button>
    </Screen>
  );
}
