/** Settings → AI assistant (plan 19, `/settings-ai`): the Enabled switch, and — only while it is on —
 *  the provider presets, key, model and the Test / Detect calls. */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { setAiFetch } from '@/shared/ai';
import { AiSettingsScreen } from './AiSettingsScreen';

describe('AiSettingsScreen', () => {
  it('while enabled shows the configuration; switched off it hides it and says what it does', () => {
    renderWithProviders(<AiSettingsScreen />);
    const enabled = screen.getByRole('switch', { name: 'AI assistant enabled' });
    expect(enabled).toBeChecked();
    expect(screen.getByLabelText('AI server URL')).toBeTruthy();
    expect(screen.getByLabelText('AI model')).toBeTruthy();
    expect(screen.getByText('Test connection')).toBeTruthy();
    expect(screen.queryByTestId('settings-ai-off')).toBeNull();

    fireEvent.press(enabled);

    expect(useSettingsStore.getState().ai.enabled).toBe(false);
    expect(screen.getByRole('switch', { name: 'AI assistant enabled' })).not.toBeChecked();
    expect(screen.getByTestId('settings-ai-off')).toHaveTextContent(/Diagnose \(AI\)/);
    expect(screen.queryByLabelText('AI server URL')).toBeNull();
    expect(screen.queryByLabelText('AI model')).toBeNull();
    expect(screen.queryByText('Provider')).toBeNull();
    expect(screen.queryByText('Test connection')).toBeNull();
  });

  it('in the browser says the AI key is memory-only (plan 28)', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    renderWithProviders(<AiSettingsScreen />);
    fireEvent.press(screen.getByText('Anthropic'));
    expect(screen.getByTestId('settings-ai-key-web')).toHaveTextContent(/never saved/);
    expect(screen.queryByText(/secure keystore, never in backups/)).toBeNull();
    jest.restoreAllMocks();
  });
});

describe('SettingsScreen AI provider (plan 19)', () => {
  afterEach(() => setAiFetch(null));

  it('Anthropic fills the URL and model, hides Structured output and shows the key field', async () => {
    renderWithProviders(<AiSettingsScreen />);
    expect(screen.getByTestId('ai-structured-output')).toBeTruthy();
    expect(screen.queryByLabelText('Anthropic API key')).toBeNull();

    fireEvent.press(screen.getByText('Anthropic'));

    await waitFor(() => expect(useSettingsStore.getState().ai.provider).toBe('anthropic'));
    const { ai } = useSettingsStore.getState();
    expect(ai.baseUrl).toBe('https://api.anthropic.com');
    expect(ai.model).toBe('claude-sonnet-5-5');
    expect(ai.jsonMode).toBe('off');
    expect(screen.getByTestId('ai-fixed-url')).toHaveTextContent('https://api.anthropic.com');
    expect(screen.queryByTestId('ai-structured-output')).toBeNull();
    expect(screen.getByLabelText('Anthropic API key')).toBeTruthy();
    expect(screen.getByText(/secure keystore, never in backups/)).toBeTruthy();
    expect(screen.getByText(/console\.anthropic\.com/)).toBeTruthy();
  });

  it('Edit on a cloud URL flips to Custom and keeps the address', async () => {
    renderWithProviders(<AiSettingsScreen />);
    fireEvent.press(screen.getByText('OpenAI'));
    await waitFor(() => expect(useSettingsStore.getState().ai.provider).toBe('openai'));

    fireEvent.press(screen.getByLabelText('Edit the server address (switches to Custom)'));

    const { ai } = useSettingsStore.getState();
    expect(ai.provider).toBe('custom');
    expect(ai.baseUrl).toBe('https://api.openai.com');
    expect(screen.queryByTestId('ai-fixed-url')).toBeNull();
    expect(screen.getByLabelText('Custom API key')).toBeTruthy();
  });

  it('Test connection on Anthropic calls the Messages API models list with the key', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    setAiFetch(async (url, init) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] }),
        text: async () => '',
      } as Response;
    });
    renderWithProviders(<AiSettingsScreen />);
    fireEvent.press(screen.getByText('Anthropic'));
    fireEvent.changeText(screen.getByLabelText('Anthropic API key'), 'sk-ant-test');

    fireEvent.press(screen.getByText('Test connection'));

    expect(await screen.findByText(/Connected ✓ — 2 models/)).toBeTruthy();
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-test');
    expect(useSettingsStore.getState().ai.apiKey).toBe('sk-ant-test');
  });

  it('a Detect that finishes after a provider switch does not touch the new provider', async () => {
    let respond: () => void = () => {};
    setAiFetch(
      () =>
        new Promise<Response>((resolve) => {
          respond = () =>
            resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              json: async () => ({ data: [{ id: 'lmstudio-local-model' }] }),
              text: async () => '',
            } as Response);
        }),
    );
    useSettingsStore.setState((s) => ({
      ai: { ...s.ai, provider: 'local', baseUrl: 'http://192.168.1.50:1234' },
    }));
    renderWithProviders(<AiSettingsScreen />);
    fireEvent.press(screen.getByText('Detect model'));
    expect(await screen.findByText('Connecting…')).toBeTruthy();

    fireEvent.press(screen.getByText('Anthropic'));
    await waitFor(() => expect(useSettingsStore.getState().ai.provider).toBe('anthropic'));
    await act(async () => respond());

    await waitFor(() => expect(screen.getByText('Detect model')).toBeEnabled());
    expect(useSettingsStore.getState().ai.model).toBe('claude-sonnet-5-5');
    expect(screen.queryByText(/Connected ✓/)).toBeNull();
    expect(screen.queryByText('Connecting…')).toBeNull();
  });
});
