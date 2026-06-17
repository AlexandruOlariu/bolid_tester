import React, { useState } from 'react';
import { Platform } from 'react-native';
import { ScrollView, YStack, XStack, Text, Paragraph, Button, Card, Input, Spinner } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { useSessionStore } from '@/shared/state/sessionStore';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { normalizeBaseUrl } from '@/shared/obd-core';
import { listModels, AiClientError } from '@/shared/ai';
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

function AiSection() {
  const ai = useSettingsStore((s) => s.ai);
  const setAi = useSettingsStore((s) => s.setAi);
  const [testing, setTesting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const test = async (autofillModel: boolean) => {
    setTesting(true);
    setStatusText('Connecting…');
    try {
      const models = await listModels(ai);
      if (models.length === 0) {
        setStatusText('Connected, but the server lists no models. Load a model on the server first.');
      } else {
        if (autofillModel) setAi({ model: models[0] });
        const shown = models.slice(0, 4).join(', ');
        setStatusText(`Connected ✓ — ${models.length} model(s): ${shown}${models.length > 4 ? '…' : ''}`);
      }
    } catch (e) {
      setStatusText(`Failed: ${e instanceof AiClientError || e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <YStack gap="$2">
      <SectionLabel>AI assistant (auto-diagnose)</SectionLabel>
      <SegGroup>
        <YStack gap="$3">
          <XStack gap="$2" alignItems="center">
            <Paragraph flex={1}>Enabled</Paragraph>
            <Seg active={ai.enabled} label="On" onPress={() => setAi({ enabled: true })} />
            <Seg active={!ai.enabled} label="Off" onPress={() => setAi({ enabled: false })} />
          </XStack>

          <YStack gap="$1">
            <Paragraph theme="alt2" fontSize="$2">
              Server URL (OpenAI-compatible, e.g. LM Studio)
            </Paragraph>
            <Input
              value={ai.baseUrl}
              onChangeText={(t) => setAi({ baseUrl: t })}
              placeholder="http://192.168.1.50:1234"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {ai.baseUrl ? (
              <Paragraph theme="alt2" fontSize="$1">
                → {normalizeBaseUrl(ai.baseUrl)}/chat/completions
              </Paragraph>
            ) : null}
          </YStack>

          <YStack gap="$1">
            <Paragraph theme="alt2" fontSize="$2">
              Model
            </Paragraph>
            <Input
              value={ai.model}
              onChangeText={(t) => setAi({ model: t })}
              placeholder="e.g. qwen2.5-7b-instruct"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </YStack>

          <YStack gap="$1">
            <XStack gap="$2" alignItems="center" flexWrap="wrap">
              <Paragraph flex={1}>Structured output</Paragraph>
              <Seg active={ai.jsonMode === 'schema'} label="Schema" onPress={() => setAi({ jsonMode: 'schema' })} />
              <Seg active={ai.jsonMode === 'object'} label="JSON" onPress={() => setAi({ jsonMode: 'object' })} />
              <Seg active={ai.jsonMode === 'off'} label="Off" onPress={() => setAi({ jsonMode: 'off' })} />
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              Schema = json_schema (LM Studio / current OpenAI). JSON = json_object (older OpenAI). Off
              = plain text. The app auto-falls back to text if the server rejects the format.
            </Paragraph>
          </YStack>

          <XStack gap="$2" alignItems="center" flexWrap="wrap">
            <Paragraph>Timeout</Paragraph>
            {[15000, 30000, 60000].map((ms) => (
              <Seg
                key={ms}
                active={ai.timeoutMs === ms}
                label={`${ms / 1000}s`}
                onPress={() => setAi({ timeoutMs: ms })}
              />
            ))}
          </XStack>

          <XStack gap="$2">
            <Button
              flex={1}
              onPress={() => void test(false)}
              disabled={testing}
              icon={testing ? () => <Spinner /> : undefined}
            >
              Test connection
            </Button>
            <Button flex={1} theme="green" onPress={() => void test(true)} disabled={testing}>
              Detect model
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

      <AiSection />

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
