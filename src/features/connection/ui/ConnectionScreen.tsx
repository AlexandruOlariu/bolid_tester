import React from 'react';
import { YStack, XStack, Button, Paragraph, Spinner, Text } from 'tamagui';
import { Screen, StatusBadge } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useScan } from '../hooks/useScan';
import { useConnect } from '../hooks/useConnect';
import { DeviceRow } from './DeviceRow';
import { Panel } from '../styles/connection.styles';

export function ConnectionScreen() {
  const adapterSource = useSettingsStore((s) => s.adapterSource);
  const simulated = useSettingsStore((s) => s.simulatedVehicleId);
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const { scanning, devices, start, stop } = useScan();
  const { connect, busy } = useConnect();

  return (
    <Screen title="Connect" subtitle="Pair with your OBD2 adapter, or use the built-in simulator">
      <XStack>
        <StatusBadge status={status} />
      </XStack>

      {error ? (
        <Panel backgroundColor="$red2">
          <Paragraph color="$red10">{error}</Paragraph>
        </Panel>
      ) : null}

      {adapterSource === 'mock' ? (
        <YStack gap="$3">
          <Paragraph>
            Simulator mode is on (change in Settings). Emulating:{' '}
            <Text fontWeight="700">{simulated}</Text>.
          </Paragraph>
          <Button
            theme="green"
            disabled={busy}
            icon={busy ? () => <Spinner /> : undefined}
            onPress={() => connect()}
          >
            Connect to simulator
          </Button>
        </YStack>
      ) : (
        <YStack gap="$3">
          <Button
            theme="blue"
            onPress={scanning ? stop : start}
            icon={scanning ? () => <Spinner /> : undefined}
          >
            {scanning ? 'Scanning…' : 'Scan for adapters'}
          </Button>
          <YStack gap="$2">
            {devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                disabled={busy}
                onConnect={() => connect({ deviceId: d.id, deviceName: d.name ?? undefined })}
              />
            ))}
            {!scanning && devices.length === 0 ? (
              <Paragraph theme="alt2">
                No devices yet. Plug in the adapter, switch ignition on, then scan.
              </Paragraph>
            ) : null}
          </YStack>
        </YStack>
      )}
    </Screen>
  );
}
