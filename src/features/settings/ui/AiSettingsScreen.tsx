import React, { useState } from 'react';
import { Platform } from 'react-native';
import { YStack, XStack, Paragraph, Button, Input, Spinner } from 'tamagui';
import { Screen, SegmentedControl, LabeledSwitch, HIT_SLOP, type SegmentOption } from '@/shared/ui';
import { useSettingsStore } from '@/shared/state/settingsStore';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_PRESETS,
  normalizeBaseUrl,
  type AiProviderId,
} from '@/shared/obd-core';
import { getAiClient, AiClientError } from '@/shared/ai';
import { logError } from '@/shared/state/errorLogStore';
import { useTranslation, type TFunction } from '@/shared/i18n';
import { useBackToSettings } from '../hooks/useBackToSettings';
import { SegGroup } from './parts';

const jsonModeOptions = (t: TFunction): SegmentOption<'schema' | 'object' | 'off'>[] => [
  { value: 'schema', label: t('ai.jsonSchema') },
  { value: 'object', label: 'JSON' },
  { value: 'off', label: t('ai.jsonOff'), accessibilityLabel: t('ai.jsonOffA11y') },
];

const timeoutOptions = (t: TFunction): SegmentOption<number>[] =>
  [15000, 30000, 60000].map((ms) => ({
    value: ms,
    label: `${ms / 1000}s`,
    accessibilityLabel: t('seconds', { count: ms / 1000 }),
  }));

/** The provider, address, key, model, output mode and timeout, with **Test connection** and
 *  **Detect model** (plan 19). Shown only while the assistant is enabled. */
function AiConfig() {
  const { t } = useTranslation('settings');
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
    setStatusText(t('ai.connecting'));
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
        setStatusText(t('ai.noModels'));
      } else {
        // A cloud list is long: keep a listed model there; a local server's first model is the loaded one.
        if (autofillModel && !(fixedUrl && models.includes(ai.model))) setAi({ model: models[0] });
        const shown = models.slice(0, 4).join(', ');
        setStatusText(
          t('ai.connected', {
            count: models.length,
            models: `${shown}${models.length > 4 ? '…' : ''}`,
          }),
        );
      }
    } catch (e) {
      if (stale()) return;
      setStatusText(
        t('ai.failed', {
          error: e instanceof AiClientError || e instanceof Error ? e.message : String(e),
        }),
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
    <>
      <YStack gap="$1">
        <Paragraph theme="alt2" fontSize="$2">
          {t('ai.provider')}
        </Paragraph>
        <SegmentedControl
          label={t('ai.providerA11y')}
          options={AI_PROVIDER_IDS.map((id) => ({
            value: id,
            label: t(`ai.providerLabel.${id}`, { defaultValue: AI_PROVIDER_PRESETS[id].label }),
          }))}
          value={ai.provider}
          onChange={switchProvider}
        />
        <Paragraph theme="alt2" fontSize="$1">
          {t(`ai.providerHint.${ai.provider}`, { defaultValue: preset.hint })}
        </Paragraph>
      </YStack>

      <YStack gap="$1">
        <Paragraph theme="alt2" fontSize="$2">
          {fixedUrl ? t('ai.serverUrl') : t('ai.serverUrlCustom')}
        </Paragraph>
        {fixedUrl ? (
          <XStack gap="$2" alignItems="center">
            <Paragraph flex={1} fontSize="$3" testID="ai-fixed-url">
              {ai.baseUrl}
            </Paragraph>
            <Button
              size="$3"
              hitSlop={HIT_SLOP}
              chromeless
              accessibilityLabel={t('ai.editUrlA11y')}
              onPress={() => setAi({ provider: 'custom', baseUrl: ai.baseUrl, model: ai.model })}
            >
              {t('ai.edit')}
            </Button>
          </XStack>
        ) : (
          <Input
            value={ai.baseUrl}
            onChangeText={(text) => setAi({ baseUrl: text })}
            placeholder="http://192.168.1.50:1234"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel={t('ai.serverUrlA11y')}
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
            {preset.needsKey ? t('ai.apiKey') : t('ai.apiKeyOptional')}
          </Paragraph>
          <Input
            value={ai.apiKey}
            onChangeText={(text) => setAi({ apiKey: text.trim() })}
            placeholder={preset.needsKey ? t('ai.apiKeyPlaceholder') : t('ai.apiKeyIfAsked')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t('ai.apiKeyA11y', {
              provider: t(`ai.providerLabel.${ai.provider}`, { defaultValue: preset.label }),
            })}
          />
          {Platform.OS === 'web' ? (
            // Web (plan 28): there is no keystore in the browser, so the key is memory-only.
            <Paragraph theme="alt2" fontSize="$1" testID="settings-ai-key-web">
              {t('ai.keyWeb')}
            </Paragraph>
          ) : (
            <Paragraph theme="alt2" fontSize="$1">
              {t('ai.keyStored')}
            </Paragraph>
          )}
        </YStack>
      ) : null}

      <YStack gap="$1">
        <Paragraph theme="alt2" fontSize="$2">
          {t('ai.model')}
        </Paragraph>
        <Input
          value={ai.model}
          onChangeText={(text) => setAi({ model: text })}
          placeholder={preset.defaultModel || t('ai.modelPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('ai.modelA11y')}
        />
      </YStack>

      {anthropic ? null : (
        <YStack gap="$1" testID="ai-structured-output">
          <Paragraph>{t('ai.structured')}</Paragraph>
          <SegmentedControl
            label={t('ai.structured')}
            options={jsonModeOptions(t)}
            value={ai.jsonMode}
            onChange={(jsonMode) => setAi({ jsonMode })}
          />
          <Paragraph theme="alt2" fontSize="$1">
            {t('ai.structuredHelp')}
          </Paragraph>
        </YStack>
      )}

      <YStack gap="$1">
        <Paragraph>{t('ai.timeout')}</Paragraph>
        <SegmentedControl
          label={t('ai.timeoutA11y')}
          options={timeoutOptions(t)}
          value={ai.timeoutMs}
          onChange={(timeoutMs) => setAi({ timeoutMs })}
        />
      </YStack>

      <XStack gap="$2">
        <Button
          flex={1}
          onPress={() => void test(false)}
          disabled={testing}
          icon={testing ? () => <Spinner /> : undefined}
        >
          {t('ai.test')}
        </Button>
        <Button flex={1} theme="green" onPress={() => void test(true)} disabled={testing}>
          {t('ai.detect')}
        </Button>
      </XStack>
      {statusText ? (
        <Paragraph theme="alt2" fontSize="$2">
          {statusText}
        </Paragraph>
      ) : null}
    </>
  );
}

/** Settings → **AI assistant** (plan 19, route `/settings-ai`): the **Enabled** switch, then — only
 *  while it is on — one line on what is sent (plan 34d) and the provider configuration. Off, one
 *  line says what turning it on does. */
export function AiSettingsScreen() {
  const { t } = useTranslation('settings');
  useBackToSettings();
  const enabled = useSettingsStore((s) => s.ai.enabled);
  const setAi = useSettingsStore((s) => s.setAi);

  return (
    <Screen title={t('hub.ai')}>
      <SegGroup>
        <YStack gap="$3">
          <LabeledSwitch
            label={t('ai.enabled')}
            accessibilityLabel={t('ai.enabledA11y')}
            checked={enabled}
            onCheckedChange={(next) => setAi({ enabled: next })}
            testID="settings-ai-enabled"
          />
          {enabled ? (
            <>
              <Paragraph theme="alt2" fontSize="$2" testID="settings-ai-what-is-sent">
                {t('ai.whatIsSent')}
              </Paragraph>
              <AiConfig />
            </>
          ) : (
            <Paragraph theme="alt2" fontSize="$2" testID="settings-ai-off">
              {t('ai.offHelp')}
            </Paragraph>
          )}
        </YStack>
      </SegGroup>
    </Screen>
  );
}
