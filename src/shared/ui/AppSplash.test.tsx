/** The splash's language gate (plan 11): i18next starts in English and the stored / device language
 *  lands a moment later, so the splash shows no words and stays up until the root layout reports the
 *  language applied — a Romanian phone never reads an English frame. Plain React Native (no Tamagui),
 *  so it renders without the providers. */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { i18n } from '@/shared/i18n';
import { AppSplash } from './AppSplash';

const MIN_VISIBLE_MS = 1100;

describe('AppSplash language gate (plan 11)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows no words and stays up while the language is not applied, even after the minimum time', () => {
    render(<AppSplash ready={false} />);
    act(() => jest.advanceTimersByTime(MIN_VISIBLE_MS * 3));
    const splash = screen.getByTestId('app-splash');
    expect(splash.props.pointerEvents).toBe('auto');
    expect(screen.getByTestId('app-splash-subtitle')).toHaveTextContent(' ');
    expect(screen.queryByText('OBD2 diagnostics')).toBeNull();
    expect(screen.queryByLabelText('Loading your saved data')).toBeNull();
  });

  it('once the Romanian language is applied, the words appear in Romanian and the splash lets go', async () => {
    const view = render(<AppSplash ready={false} />);
    await act(async () => {
      await i18n.changeLanguage('ro');
    });
    view.rerender(<AppSplash ready />);
    // Still inside the minimum display time: the splash is up, now with its Romanian words.
    expect(screen.getByText('Diagnoză OBD2')).toBeTruthy();
    expect(screen.getByLabelText('Se încarcă datele salvate')).toBeTruthy();
    expect(screen.queryByText('OBD2 diagnostics')).toBeNull();

    act(() => jest.advanceTimersByTime(MIN_VISIBLE_MS * 3));
    expect(screen.queryByTestId('app-splash')).toBeNull();
  });
});
