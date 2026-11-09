import React, { useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ScrollView, YStack, XStack, Text, Paragraph, Button, Card, Input, Spinner } from 'tamagui';
import { Screen } from '@/shared/ui';
import { useSettingsStore, parseDtcList } from '@/shared/state/settingsStore';
import {
  useAdapterLogStore,
  clearAdapterLog,
  ADAPTER_LOG_CAPACITY,
} from '@/shared/state/adapterLog';
import { useSessionStore } from '@/shared/state/sessionStore';
import { useGarageStore } from '@/shared/state/garageStore';
import { VEHICLE_PROFILES } from '@/shared/vehicles';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_PRESETS,
  normalizeBaseUrl,
  type AiProviderId,
} from '@/shared/obd-core';
import { getAiClient, AiClientError } from '@/shared/ai';
import { logError } from '@/shared/state/errorLogStore';
import { useLogFixtureExport } from '../hooks/useLogFixtureExport';
import { DEFAULT_FLOW_NAME, fixtureVehicleId } from '../model/replayExport';
import { useVehicleStore } from '@/features/vehicle-select/model/vehicleStore';
import { connectionService } from '@/features/connection';
import { APP_NAME, APP_VERSION } from '@/shared/lib/appInfo';
import { PRIVACY_POLICY, PRIVACY_POLICY_UPDATED } from '../model/privacyPolicy';

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
  const preset = AI_PROVIDER_PRESETS[ai.provider] ?? AI_PROVIDER_PRESETS.local;
  const fixedUrl = !!preset.baseUrl;
  const anthropic = preset.wire === 'anthropic-messages';

  const switchProvider = (provider: AiProviderId) => {
    setStatusText(null);
    setAi({ provider });
  };

  const test = async (autofillModel: boolean) => {
    setTesting(true);
    setStatusText('Connecting…');
    // The owner may switch provider (or edit the address) while the request runs: its model list
    // and status then belong to settings no longer shown, so they are dropped, not applied.
    const stale = () => {
      const cur = useSettingsStore.getState().ai;
      if (cur.provider === ai.provider && cur.baseUrl === ai.baseUrl) return false;
      setStatusText(null);
      return true;
    };
    try {
      const models = await getAiClient(ai).listModels();
      if (stale()) return;
      if (models.length === 0) {
        setStatusText(
          'Connected, but the server lists no models. Load a model on the server first.',
        );
      } else {
        // A cloud list is long: keep a listed model there; a local server's first model is the loaded one.
        if (autofillModel && !(fixedUrl && models.includes(ai.model))) setAi({ model: models[0] });
        const shown = models.slice(0, 4).join(', ');
        setStatusText(
          `Connected ✓ — ${models.length} model(s): ${shown}${models.length > 4 ? '…' : ''}`,
        );
      }
    } catch (e) {
      if (stale()) return;
      setStatusText(
        `Failed: ${e instanceof AiClientError || e instanceof Error ? e.message : String(e)}`,
      );
      logError({
        source: 'settings/ai-test',
        error: e,
        severity: 'warning',
        context: { provider: ai.provider, baseUrl: ai.baseUrl },
      });
    } finally {
      setTesting(false);
    }
  };

  const target = anthropic ? 'messages' : 'chat/completions';

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
              Provider
            </Paragraph>
            <XStack gap="$2" flexWrap="wrap">
              {AI_PROVIDER_IDS.map((id) => (
                <Seg
                  key={id}
                  active={ai.provider === id}
                  label={AI_PROVIDER_PRESETS[id].label}
                  onPress={() => switchProvider(id)}
                />
              ))}
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              {preset.hint}
            </Paragraph>
          </YStack>

          <YStack gap="$1">
            <Paragraph theme="alt2" fontSize="$2">
              {fixedUrl ? 'Server URL' : 'Server URL (OpenAI-compatible, e.g. LM Studio or Ollama)'}
            </Paragraph>
            {fixedUrl ? (
              <XStack gap="$2" alignItems="center">
                <Paragraph flex={1} fontSize="$3" testID="ai-fixed-url">
                  {ai.baseUrl}
                </Paragraph>
                <Button
                  size="$2"
                  chromeless
                  accessibilityLabel="Edit the server address (switches to Custom)"
                  onPress={() =>
                    setAi({ provider: 'custom', baseUrl: ai.baseUrl, model: ai.model })
                  }
                >
                  Edit
                </Button>
              </XStack>
            ) : (
              <Input
                value={ai.baseUrl}
                onChangeText={(t) => setAi({ baseUrl: t })}
                placeholder="http://192.168.1.50:1234"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            )}
            {ai.baseUrl ? (
              <Paragraph theme="alt2" fontSize="$1">
                → {normalizeBaseUrl(ai.baseUrl)}/{target}
              </Paragraph>
            ) : null}
          </YStack>

          {ai.provider !== 'local' ? (
            <YStack gap="$1">
              <Paragraph theme="alt2" fontSize="$2">
                {preset.needsKey ? 'API key' : 'API key (optional)'}
              </Paragraph>
              <Input
                value={ai.apiKey}
                onChangeText={(t) => setAi({ apiKey: t.trim() })}
                placeholder={preset.needsKey ? 'Paste your API key' : 'Only if the server asks'}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={`${preset.label} API key`}
              />
              <Paragraph theme="alt2" fontSize="$1">
                Stored in the phone's secure keystore, never in backups. Each provider keeps its own
                key.
              </Paragraph>
            </YStack>
          ) : null}

          <YStack gap="$1">
            <Paragraph theme="alt2" fontSize="$2">
              Model
            </Paragraph>
            <Input
              value={ai.model}
              onChangeText={(t) => setAi({ model: t })}
              placeholder={preset.defaultModel || 'e.g. qwen2.5-7b-instruct'}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </YStack>

          {anthropic ? null : (
            <YStack gap="$1" testID="ai-structured-output">
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
                Schema = json_schema (LM Studio / current OpenAI). JSON = json_object (older
                OpenAI). Off = plain text. The app auto-falls back to text if the server rejects the
                format.
              </Paragraph>
            </YStack>
          )}

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

/** Simulator-only test controls for the link-robustness paths (plan 12): drop the live simulated
 *  link (auto-reconnect + flap guard), or make the next simulator connect get no reply to `ATZ`
 *  (the Connect screen's diagnostics panel, stage "Adapter start-up"). */
function SimulatorDeveloperSection() {
  const status = useSessionStore((st) => st.status);
  const [note, setNote] = useState<string | null>(null);

  const drop = () => {
    const dropped = connectionService.__sim.simulateDrop();
    setNote(
      dropped
        ? 'Link dropped. With auto-reconnect on it reconnects in 2 s; three drops in a minute pause it.'
        : 'Connect to the simulator first.',
    );
  };
  const failNext = () => {
    connectionService.__sim.failNextConnect();
    setNote(
      'Armed: the next simulator connect gets no reply to ATZ. Connect to see the diagnostics.',
    );
  };

  return (
    <YStack gap="$2">
      <SectionLabel>Developer (simulator)</SectionLabel>
      <SegGroup>
        <YStack gap="$2">
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" disabled={status !== 'connected'} onPress={drop}>
              Simulate a link drop
            </Button>
            <Button size="$2" onPress={failNext}>
              Fail next connect: no reply to ATZ
            </Button>
          </XStack>
          <Paragraph theme="alt2" fontSize="$1">
            {note ??
              'Test the connection hardening without a car: a dropped link, and an adapter that never answers.'}
          </Paragraph>
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** Settings → About (plan 08): the app version (= the OTA runtime version) and the privacy policy,
 *  whose text lives in `model/privacyPolicy.ts` and is published as docs/privacy-policy.md. */
function AboutSection() {
  const [policyOpen, setPolicyOpen] = useState(false);

  return (
    <YStack gap="$2">
      <SectionLabel>About</SectionLabel>
      <SegGroup>
        <YStack gap="$2">
          <Paragraph fontWeight="700">
            {APP_NAME} {APP_VERSION}
          </Paragraph>
          <Paragraph theme="alt2" fontSize="$1">
            Over-the-air updates only reach installs of this same version. The app looks for one
            only when you tap More → Check for updates.
          </Paragraph>
          <Button
            size="$2"
            onPress={() => setPolicyOpen((open) => !open)}
            accessibilityLabel={policyOpen ? 'Hide the privacy policy' : 'Show the privacy policy'}
          >
            {policyOpen ? 'Hide privacy policy' : 'Privacy policy'}
          </Button>
          {policyOpen ? (
            <YStack gap="$2">
              <Paragraph theme="alt2" fontSize="$1">
                Last updated {PRIVACY_POLICY_UPDATED}
              </Paragraph>
              {PRIVACY_POLICY.map((section) => (
                <YStack key={section.heading} gap="$1">
                  <Text fontWeight="700" fontSize="$3">
                    {section.heading}
                  </Text>
                  {section.paragraphs.map((p) => (
                    <Paragraph key={p} fontSize="$2">
                      {p}
                    </Paragraph>
                  ))}
                </YStack>
              ))}
            </YStack>
          ) : null}
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** **Data** (plan 18): the way to the Backup & restore screen — one file with every store and the
 *  trip recordings, restore from such a file, and per-store JSON / CSV export. */
function DataSection() {
  const router = useRouter();
  return (
    <YStack gap="$2">
      <SectionLabel>Data</SectionLabel>
      <SegGroup>
        <YStack gap="$2">
          <Paragraph fontSize="$2">
            Keep a copy of your garage, history, scans, trips and maintenance log, or move them to a
            new phone. Nothing goes to the cloud; you choose where the file goes.
          </Paragraph>
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$3" onPress={() => router.push('/backup')}>
              Backup & restore
            </Button>
            <Button size="$3" onPress={() => router.push('/backup')}>
              Export data…
            </Button>
          </XStack>
        </YStack>
      </SegGroup>
    </YStack>
  );
}

/** Warning for an adapter log that wrapped: the export would start mid-session. */
function wrappedText(dropped: number): string {
  return `the oldest ${dropped} lines were dropped, so the export starts mid-session. Clear the log and record a shorter flow.`;
}

export function SettingsScreen() {
  const { exportFixture, busy: exportingFixture } = useLogFixtureExport();
  const s = useSettingsStore();
  const log = useAdapterLogStore((st) => st.entries);
  const logDropped = useAdapterLogStore((st) => st.dropped);
  const status = useSessionStore((st) => st.status);
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
  // an on-car validation fixture. The label is the source at export time; that matches the log
  // because `switchAdapterSource` clears the log on every switch and a superseded link logs nothing.
  const onExportFixture = async () => {
    const simulator = s.adapterSource === 'mock';
    const saved = await exportFixture({
      log,
      flow: flowName,
      vehicleId: fixtureVehicleId(
        { simulator, simulatedVehicleId: s.simulatedVehicleId, selectedProfileId },
        garage,
      ),
      source: simulator ? 'simulator' : 'car',
      adapter: info?.version,
      protocol: info?.protocol,
      droppedEntries: logDropped,
      appVersion: APP_VERSION,
    });
    setExportStatus({
      dropped: logDropped,
      text: !saved
        ? 'Could not save the replay fixture. See More → Error log for details.'
        : logDropped > 0
          ? `Saved ${saved}, but the log was full: ${wrappedText(logDropped)}`
          : `Saved ${saved}. Clear the log before recording the next flow.`,
    });
  };
  const onClearLog = () => {
    clearAdapterLog();
    setExportStatus(null);
  };

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
                {garage.map((v) => (
                  <Seg
                    key={v.id}
                    active={s.simulatedVehicleId === v.id}
                    label={v.name}
                    onPress={() => s.setSimulatedVehicle(v.id)}
                  />
                ))}
              </XStack>
              {garage.length > 0 ? (
                <Paragraph theme="alt2" fontSize="$1">
                  A garage car is simulated from its base profile, with the VIN and supported PIDs
                  learned from it.
                </Paragraph>
              ) : null}
            </SegGroup>
          </YStack>

          <InjectedDtcsSection />

          <SimulatorDeveloperSection />
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
              On by default; pauses after 3 drops in a minute. When the connection drops
              unexpectedly, reconnect to the same device with backoff (2 s, 5 s, 10 s — up to 3
              attempts). Cancelled the moment you disconnect or connect manually.
            </Paragraph>
          </YStack>
        </SegGroup>
      </YStack>

      <YStack gap="$2">
        <SectionLabel>Recognise my cars by VIN</SectionLabel>
        <SegGroup>
          <YStack gap="$2">
            <XStack gap="$2" alignItems="center">
              <Paragraph flex={1}>Select a garage car when its VIN connects</Paragraph>
              <Seg
                active={s.autoSelectByVin}
                label="On"
                onPress={() => s.setAutoSelectByVin(true)}
              />
              <Seg
                active={!s.autoSelectByVin}
                label="Off"
                onPress={() => s.setAutoSelectByVin(false)}
              />
            </XStack>
            <Paragraph theme="alt2" fontSize="$1">
              On by default. When the connected car's VIN (vehicle identification number) matches a
              car you added from a connection, that car becomes the active vehicle. Built-in
              profiles are only suggested on the Vehicle screen.
            </Paragraph>
          </YStack>
        </SegGroup>
      </YStack>

      <YStack gap="$2">
        <XStack justifyContent="space-between" alignItems="center">
          <SectionLabel>Adapter log</SectionLabel>
          <Button size="$2" onPress={onClearLog}>
            Clear
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
            accessibilityLabel="Flow name"
          />
          <Button
            size="$3"
            disabled={exportingFixture || log.length === 0}
            onPress={() => void onExportFixture()}
          >
            Export as replay fixture
          </Button>
        </XStack>
        <Paragraph theme="alt2" fontSize="$1">
          {exportStatus && logDropped <= exportStatus.dropped
            ? exportStatus.text
            : logDropped > 0
              ? `The log is full: ${wrappedText(logDropped)}`
              : `Name the flow you just ran (connect, live, faults, clear…). The file records every command and the reply it got (the last ${ADAPTER_LOG_CAPACITY} log lines), so the session can be replayed in tests.`}
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
                  color={e.dir === 'tx' ? '$blue10' : '$green10'}
                  numberOfLines={1}
                >
                  {e.dir === 'tx' ? '» ' : '« '}
                  {e.text.replace(/\s+/g, ' ').trim()}
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

      <DataSection />

      <AboutSection />

      {status === 'connected' ? (
        <Button theme="red" onPress={() => connectionService.disconnect()}>
          Disconnect
        </Button>
      ) : null}
    </Screen>
  );
}
