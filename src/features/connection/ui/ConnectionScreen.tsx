import React from 'react';
import { YStack, XStack, Button, Paragraph, Spinner, Text, Card } from 'tamagui';
import { CheckCircle2, XCircle, Loader, CircleDashed } from 'lucide-react-native';
import { Screen } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import type { ConnState } from '@/shared/state/sessionStore';
import { useScan } from '../hooks/useScan';
import { useConnect } from '../hooks/useConnect';
import { DeviceRow } from './DeviceRow';
import { Panel } from '../styles/connection.styles';

const STATUS_CONFIG: Record<ConnState, { icon: React.ElementType; color: string; label: string }> = {
  disconnected: { icon: CircleDashed,  color: '#8B949E', label: 'Disconnected' },
  connecting:   { icon: Loader,        color: '#E3B341', label: 'Connecting…'  },
  initializing: { icon: Loader,        color: '#E3B341', label: 'Initializing…'},
  connected:    { icon: CheckCircle2,  color: '#2bb673', label: 'Connected'    },
  error:        { icon: XCircle,       color: '#F85149', label: 'Error'        },
};

function StatusHero({ status }: { status: ConnState }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <Card
      bordered
      padding="$4"
      borderColor={cfg.color}
      borderWidth={1.5}
    >
      <XStack alignItems="center" gap="$3">
        <Icon size={32} color={cfg.color} />
        <YStack>
          <Text fontWeight="800" fontSize="$5" color={cfg.color}>
            {cfg.label}
          </Text>
          <Text fontSize="$2" color="$placeholderColor">
            OBD2 adapter
          </Text>
        </YStack>
      </XStack>
    </Card>
  );
}

export function ConnectionScreen() {
  const adapterSource = useSettingsStore((s) => s.adapterSource);
  const simulated = useSettingsStore((s) => s.simulatedVehicleId);
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const { scanning, devices, start, stop } = useScan();
  const { connect, busy } = useConnect();

  return (
    <Screen title="Connect" subtitle="Pair with your OBD2 adapter, or use the built-in simulator">
      <StatusHero status={status} />

      {error ? (
        <Panel backgroundColor="$red2">
          <Paragraph color="$red10">{error}</Paragraph>
        </Panel>
      ) : null}

      {adapterSource === 'mock' ? (
        <YStack gap="$3" marginTop="$2">
          <Panel>
            <Paragraph fontSize="$3">
              Simulator mode is on (change in Settings).{'\n'}Emulating:{' '}
              <Text fontWeight="700" color="$color">{simulated}</Text>
            </Paragraph>
          </Panel>
          <Button
            theme="green"
            size="$5"
            disabled={busy}
            icon={busy ? () => <Spinner /> : undefined}
            onPress={() => connect()}
          >
            Connect to simulator
          </Button>
        </YStack>
      ) : (
        <YStack gap="$3" marginTop="$2">
          <Button
            theme="blue"
            size="$5"
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
              <Paragraph theme="alt2" fontSize="$3">
                No devices yet. Plug in the adapter, switch ignition on, then scan.
              </Paragraph>
            ) : null}
          </YStack>
        </YStack>
      )}
    </Screen>
  );
}
