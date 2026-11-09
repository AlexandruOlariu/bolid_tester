/** Reduce motion (plan 20): the hook follows the OS setting, and the splash drops its decorative
 *  pulse when it is on. */
import React from 'react';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { act, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';
import { useReducedMotion } from './useReducedMotion';
import { AppSplash } from './AppSplash';

type Listener = (on: boolean) => void;

function mockReduceMotion(initial: boolean) {
  let listener: Listener | null = null;
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(initial);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    event: string,
    handler: Listener,
  ) => {
    if (event === 'reduceMotionChanged') listener = handler;
    return { remove };
  }) as unknown as typeof AccessibilityInfo.addEventListener);
  return { emit: (on: boolean) => listener?.(on), remove };
}

function Probe() {
  return <Text testID="reduced">{String(useReducedMotion())}</Text>;
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

afterEach(() => jest.restoreAllMocks());

describe('useReducedMotion', () => {
  it('reads the setting once and follows changes; unsubscribes on unmount', async () => {
    const os = mockReduceMotion(true);
    const view = renderWithProviders(<Probe />);
    await flush();
    expect(screen.getByTestId('reduced')).toHaveTextContent('true');
    act(() => os.emit(false));
    expect(screen.getByTestId('reduced')).toHaveTextContent('false');
    act(() => os.emit(true));
    expect(screen.getByTestId('reduced')).toHaveTextContent('true');
    view.unmount();
    expect(os.remove).toHaveBeenCalled();
  });

  it('is false when the setting is off', async () => {
    mockReduceMotion(false);
    renderWithProviders(<Probe />);
    await flush();
    expect(screen.getByTestId('reduced')).toHaveTextContent('false');
  });
});

describe('AppSplash under Reduce motion', () => {
  /** The subtitle's opacity: always fully opaque — ink faded over the brand green fails 4.5:1. */
  const subtitleOpacity = () => {
    const style = [screen.getByText('OBD2 diagnostics').props.style].flat(Infinity) as {
      opacity?: number;
    }[];
    return style.reduce<number | undefined>((o, st) => st?.opacity ?? o, undefined);
  };

  it('pulses the logo normally; the subtitle stays fully opaque', async () => {
    mockReduceMotion(false);
    const loop = jest.spyOn(Animated, 'loop');
    renderWithProviders(<AppSplash />);
    await flush();
    expect(loop).toHaveBeenCalled();
    expect(subtitleOpacity() ?? 1).toBe(1);
  });

  it('holds still when Reduce motion is on: no pulse', async () => {
    mockReduceMotion(true);
    const loop = jest.spyOn(Animated, 'loop');
    renderWithProviders(<AppSplash />);
    await flush();
    expect(subtitleOpacity() ?? 1).toBe(1);
    // The first render (before the setting is read) may have started it; nothing starts it again.
    loop.mockClear();
    await flush();
    expect(loop).not.toHaveBeenCalled();
    expect(screen.getByText('Bolid Tester')).toBeTruthy();
  });
});
