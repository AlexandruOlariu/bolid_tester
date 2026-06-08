import React from 'react';
import { ScrollView, YStack, XStack, Text, Paragraph, Button, Card } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { connectionService } from '@/features/connection';

function Seg({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="$2" theme={active ? 'green' : 'gray'} onPress={onPress}>
      {label}
    </Button>
  );
}

export function SettingsScreen() {
  const s = useSettingsStore();
  const status = useSessionStore((st) => st.status);

  return (
    <Screen title="Settings">
      <YStack gap="$2">
        <Text fontWeight="800">Adapter source</Text>
        <XStack gap="$2">
          <Seg active={s.adapterSource === 'mock'} label="Simulator" onPress={() => s.setAdapterSource('mock')} />
          <Seg active={s.adapterSource === 'ble'} label="Real (BLE)" onPress={() => s.setAdapterSource('ble')} />
        </XStack>
      </YStack>

      {s.adapterSource === 'mock' ? (
        <YStack gap="$2">
          <Text fontWeight="800">Simulated vehicle</Text>
          <XStack flexWrap="wrap" gap="$2">
            {VEHICLE_PROFILES.map((p) => (
              <Seg
                key={p.id}
                active={s.simulatedVehicleId === p.id}
                label={p.id}
                onPress={() => s.setSimulatedVehicle(p.id)}
              />
            ))}
          </XStack>
          <Text fontWeight="800" marginTop="$2">
            Injected DTCs
          </Text>
          <XStack flexWrap="wrap" gap="$2">
            <Seg active={s.injectedDtcs.length === 0} label="None" onPress={() => s.setInjectedDtcs([])} />
            <Seg active={s.injectedDtcs.join() === 'P0299'} label="P0299" onPress={() => s.setInjectedDtcs(['P0299'])} />
            <Seg
              active={s.injectedDtcs.join() === 'P0299,P0401'}
              label="P0299+P0401"
              onPress={() => s.setInjectedDtcs(['P0299', 'P0401'])}
            />
          </XStack>
        </YStack>
      ) : null}

      <YStack gap="$2">
        <Text fontWeight="800">Theme</Text>
        <XStack gap="$2">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <Seg key={t} active={s.theme === t} label={t} onPress={() => s.setTheme(t)} />
          ))}
        </XStack>
      </YStack>

      <YStack gap="$2">
        <Text fontWeight="800">Poll interval</Text>
        <XStack gap="$2">
          {[500, 1000, 2000].map((ms) => (
            <Seg key={ms} active={s.pollIntervalMs === ms} label={`${ms} ms`} onPress={() => s.setPollInterval(ms)} />
          ))}
        </XStack>
      </YStack>

      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <Text fontWeight="800">Adapter log</Text>
          <Button size="$2" onPress={s.clearLog}>
            Clear
          </Button>
        </XStack>
        <Card bordered padding="$2" height={220}>
          <ScrollView>
            {s.log
              .slice(-60)
              .reverse()
              .map((e, i) => (
                <Text key={i} fontSize="$1" color={e.dir === 'tx' ? '$blue10' : '$green10'} numberOfLines={1}>
                  {e.dir === 'tx' ? '» ' : '« '}
                  {e.text}
                </Text>
              ))}
            {s.log.length === 0 ? (
              <Paragraph theme="alt2" fontSize="$2">
                No adapter I/O yet.
              </Paragraph>
            ) : null}
          </ScrollView>
        </Card>
      </YStack>

      {status === 'connected' ? (
        <Button theme="red" onPress={() => connectionService.disconnect()}>
          Disconnect
        </Button>
      ) : null}
    </Screen>
  );
}
