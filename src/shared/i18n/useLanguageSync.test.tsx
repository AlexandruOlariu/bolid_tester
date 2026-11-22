import React from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useSettingsStore } from '@/shared/state/settingsStore';
import { i18n, initI18n, useTranslation } from './index';
import { useLanguageSync } from './useLanguageSync';

function Probe() {
  const ready = useLanguageSync();
  const { t } = useTranslation();
  return <Text testID="probe">{`${ready ? 'ready' : 'waiting'}:${t('nav.settings')}`}</Text>;
}

describe('useLanguageSync (plan 11)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('waits (not ready, still English) until the settings file has hydrated', async () => {
    let finish: (() => void) | null = null;
    jest.spyOn(useSettingsStore.persist, 'hasHydrated').mockReturnValue(false);
    jest.spyOn(useSettingsStore.persist, 'onFinishHydration').mockImplementation((fn) => {
      finish = () => fn(useSettingsStore.getState());
      return () => undefined;
    });
    useSettingsStore.setState({ language: 'ro' });
    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('waiting:Settings');
    expect(i18n.language).toBe('en');

    act(() => finish?.());
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Setări'));
  });

  it('applies the stored language once settings are loaded, then reports ready', async () => {
    useSettingsStore.setState({ language: 'ro' });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Setări'));
    expect(i18n.language).toBe('ro');
  });

  it('follows a change of the preference live', async () => {
    useSettingsStore.setState({ language: 'ro' });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Setări'));
    await act(async () => {
      useSettingsStore.getState().setLanguage('en');
    });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ready:Settings'));
  });

  it('"system" without a device language falls back to English', async () => {
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    expect(await initI18n('system')).toBe('en');
    expect(i18n.language).toBe('en');
  });
});
