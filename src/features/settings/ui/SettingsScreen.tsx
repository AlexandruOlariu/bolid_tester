import React from 'react';
import { Platform } from 'react-native';
import { ScrollView, YStack, XStack, Text, Paragraph, Button, Card } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { connectionService } from '@/features/connection';

const ACCENT = '#2bb673';

function SectionLabel({ children }: { children: string }) {
  return (
    <Text fontWeight="800" fontSize="$2" color={ACCENT} letterSpacing={0.8} textTransform="uppercase">
      {children}
    </Text>
  );
}

function Seg({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="$2" theme={active ? 'green' : 'gray'} onPress={onPress}>
      {label}
    </Button>
  );
}

function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <Card bordered padding="$3" backgroundColor="$backgroundHover">
      {children}
    </Card>
  );
}

export function SettingsScreen() {
  const s = useSettingsStore();
  const status = useSessionStore((st) => st.status);
  const monoFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

  return (
    <Screen title="Settings">
      <YStack gap="$2">
        <SectionLabel>Adapter source</SectionLabel>
        <SegGroup>
          <XStack gap="$2">
            <Seg active={s.adapterSource === 'mock'} label="Simulator" onPress={() => s.setAdapterSource('mock')} />
            <Seg active={s.adapterSource === 'ble'} label="Real (BLE)" onPress={() => s.setAdapterSource('ble')} />
          </XStack>
        </SegGroup>
      </YStack>

      {s.adapterSource === 'mock' ? (
        <>
          <YStack gap="$2">
            <SectionLabel>Simulated vehicle</SectionLabel>
            <SegGroup>
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
            </SegGroup>
          </YStack>

          <YStack gap="$2">
            <SectionLabel>Injected DTCs</SectionLabel>
            <SegGroup>
              <XStack flexWrap="wrap" gap="$2">
                <Seg active={s.injectedDtcs.length === 0} label="None" onPress={() => s.setInjectedDtcs([])} />
                <Seg active={s.injectedDtcs.join() === 'P0299'} label="P0299" onPress={() => s.setInjectedDtcs(['P0299'])} />
                <Seg
                  active={s.injectedDtcs.join() === 'P0299,P0401'}
                  label="P0299+P0401"
                  onPress={() => s.setInjectedDtcs(['P0299', 'P0401'])}
                />
              </XStack>
            </SegGroup>
          </YStack>
        </>
      ) : null}

      <YStack gap="$2">
        <SectionLabel>Theme</SectionLabel>
        <SegGroup>
          <XStack gap="$2">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Seg key={t} active={s.theme === t} label={t} onPress={() => s.setTheme(t)} />
            ))}
          </XStack>
        </SegGroup>
      </YStack>

      <YStack gap="$2">
        <SectionLabel>Poll interval</SectionLabel>
        <SegGroup>
          <XStack gap="$2">
            {[500, 1000, 2000].map((ms) => (
              <Seg key={ms} active={s.pollIntervalMs === ms} label={`${ms} ms`} onPress={() => s.setPollInterval(ms)} />
            ))}
          </XStack>
        </SegGroup>
      </YStack>

      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <SectionLabel>Adapter log</SectionLabel>
          <Button size="$2" onPress={s.clearLog}>
            Clear
          </Button>
        </XStack>
        <Card bordered padding="$2" height={220} backgroundColor="$backgroundStrong">
          <ScrollView>
            {s.log
              .slice(-60)
              .reverse()
              .map((e, i) => (
                <Text
                  key={i}
                  fontSize="$1"
                  fontFamily={monoFont}
                  color={e.dir === 'tx' ? '$blue10' : '$green10'}
                  numberOfLines={1}
                >
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
