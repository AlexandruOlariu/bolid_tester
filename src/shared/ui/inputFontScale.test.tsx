/** Plan 20 manual check: at the largest font size a fixed-height `Input` clipped its text, so
 *  `tamagui.config.ts` caps every Input's font scaling at 1.5x through `defaultProps`. */
import React from 'react';
import { TextInput } from 'react-native';
import { Input } from 'tamagui';
import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@test/renderWithProviders';

describe('Input font scaling', () => {
  it('caps every Input at 1.5x the base size by default', () => {
    renderWithProviders(<Input accessibilityLabel="Search" />);
    const input = screen.UNSAFE_getByType(TextInput);
    expect(input.props.maxFontSizeMultiplier).toBe(1.5);
  });

  it('still lets a screen pass its own cap', () => {
    renderWithProviders(<Input accessibilityLabel="Search" maxFontSizeMultiplier={1.2} />);
    expect(screen.UNSAFE_getByType(TextInput).props.maxFontSizeMultiplier).toBe(1.2);
  });
});
