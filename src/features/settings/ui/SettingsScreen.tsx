import React, { useState } from 'react';
import { Platform } from 'react-native';
import { ScrollView, YStack, XStack, Text, Paragraph, Button, Card, Input, Spinner } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSettingsStore, parseDtcList } from '@/shared/state/settingsStore';
import { useAdapterLogStore, clearAdapterLog } from '@/shared/state/adapterLog';
import { useSessionStore } from '@/shared/state/sessionStore';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import { normalizeBaseUrl } from '@/shared/obd-core';
import { listModels, AiClientError } from '@/shared/ai';
import { logError } from '@/shared/state/errorLogStore';
import { useLogFixtureExport } from '../hooks/useLogFixtureExport';
import { connectionService } from '@/features/connection';

const ACCENT = '#2bb673';

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontWeight="800"
      fontSize="$2"
      color={ACCENT}
      letterSpacing={0.8}
      textTransform="uppercase"
    >
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
        setStatusText(
          'Connected, but the server lists no models. Load a model on the server first.',
        );
      } else {
        if (autofillModel) setAi({ model: models[0] });
        const shown = models.slice(0, 4).join(', ');
        setStatusText(
          `Connected ✓ — ${models.length} model(s): ${shown}${models.length > 4 ? '…' : ''}`,
        );
      }
    } catch (e) {
      setStatusText(
        `Failed: ${e instanceof AiClientError || e instanceof Error ? e.message : String(e)}`,
      );
      logError({
        source: 'settings/ai-test',
        error: e,
        severity: 'warning',
        context: { baseUrl: ai.baseUrl },
      });
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
              <Seg
                active={ai.jsonMode === 'schema'}
                label="Schema"
                onPress={() => setAi({ jsonMode: 'schema' })}
              />
              <Seg
                active={ai.jsonMode === 'object'}
                label="JSON"
                onPress={() => setAi({ jsonMode: 'object' })}
              />
              <Seg
                active={ai.jsonMode === 'off'}
                label="Off"
                onPress={() => setAi({ jsonMode: 'off' })}
              />
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              Schema = json_schema (LM Studio / current OpenAI). JSON = json_object (older OpenAI).
              Off = plain text. The app auto-falls back to text if the server rejects the format.
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

const DTC_PRESETS: { label: string; codes: string[] }[] = [
  { label: 'None', codes: [] },
  { label: 'P0299', codes: ['P0299'] },
  { label: 'P0299+P0401', codes: ['P0299', 'P0401'] },
];

/** Simulator fault injection: three presets plus **Custom…**, a free-text list of codes
 *  (comma-separated, each `[PCBU]` + 4 hex digits; invalid entries are ignored). */
function InjectedDtcsSection() {
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
      <SectionLabel>Injected DTCs</SectionLabel>
      <SegGroup>
        <YStack gap="$2">
          <XStack flexWrap="wrap" gap="$2">
            {DTC_PRESETS.map((p) => (
              <Seg
                key={p.label}
                active={!customOpen && injected.join() === p.codes.join()}
                label={p.label}
                onPress={() => pickPreset(p.codes)}
              />
            ))}
            <Seg
              active={customOpen}
              label="Custom…"
              onPress={() => {
                setCustomOpen(true);
                setInjectedDtcs(parseDtcList(customText));
              }}
            />
          </XStack>
          {customOpen ? (
            <YStack gap="$1">
              <Input
                value={customText}
                onChangeText={editCustom}
                placeholder="e.g. P0135, P0420"
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Custom fault codes to inject, comma-separated"
              />
              <Paragraph theme="alt2" fontSize="$1">
                {injected.length > 0
                  ? `Injecting: ${injected.join(', ')}. Reconnect the simulator to apply.`
                  : 'Enter codes like P0135 (letter P, C, B or U plus four digits). Invalid codes are ignored.'}
              </Paragraph>
            </YStack>
          ) : null}
        </YStack>
      </SegGroup>
    </YStack>
  );
}

export function SettingsScreen() {
  const { exportFixture, busy: exportingFixture } = useLogFixtureExport();
  const s = useSettingsStore();
  const log = useAdapterLogStore((st) => st.entries);
  const status = useSessionStore((st) => st.status);
  const monoFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

  return (
    <Screen title="Settings">
      <YStack gap="$2">
        <SectionLabel>Adapter source</SectionLabel>
        <SegGroup>
          <YStack gap="$2">
            <XStack gap="$2" flexWrap="wrap">
              <Seg
                active={s.adapterSource === 'ble'}
                label="Real adapter (Bluetooth)"
                onPress={() => void connectionService.switchAdapterSource('ble')}
              />
              <Seg
                active={s.adapterSource === 'mock'}
                label="Simulator (no car)"
                onPress={() => void connectionService.switchAdapterSource('mock')}
              />
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              The simulator emulates a real ECU so every screen works with no hardware. A banner
              stays visible while it is on. Switching disconnects the current session.
            </Paragraph>
          </YStack>
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

          <InjectedDtcsSection />
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
            {[250, 500, 1000, 2000].map((ms) => (
              <Seg
                key={ms}
                active={s.pollIntervalMs === ms}
                label={`${ms} ms`}
                onPress={() => s.setPollInterval(ms)}
              />
            ))}
          </XStack>
        </SegGroup>
      </YStack>

      <YStack gap="$2">
        <SectionLabel>Auto-reconnect</SectionLabel>
        <SegGroup>
          <YStack gap="$2">
            <XStack gap="$2" alignItems="center">
              <Paragraph flex={1}>Retry the last adapter after a dropped link</Paragraph>
              <Seg active={s.autoReconnect} label="On" onPress={() => s.setAutoReconnect(true)} />
              <Seg
                active={!s.autoReconnect}
                label="Off"
                onPress={() => s.setAutoReconnect(false)}
              />
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              When the connection drops unexpectedly, reconnect to the same device with backoff (2s,
              5s, 10s — up to 3 attempts). Cancelled the moment you disconnect or connect manually.
            </Paragraph>
          </YStack>
        </SegGroup>
      </YStack>

      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <SectionLabel>Adapter log</SectionLabel>
          <XStack gap="$2">
            <Button
              size="$2"
              disabled={exportingFixture || log.length === 0}
              onPress={() => void exportFixture(log, 'adapter session')}
            >
              Export as replay fixture
            </Button>
            <Button size="$2" onPress={clearAdapterLog}>
              Clear
            </Button>
          </XStack>
        </XStack>
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
                  color={e.dir === 'tx' ? '$blue10' : '$green10'}
                  numberOfLines={1}
                >
                  {e.dir === 'tx' ? '» ' : '« '}
                  {e.text}
                </Text>
              ))}
            {log.length === 0 ? (
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
