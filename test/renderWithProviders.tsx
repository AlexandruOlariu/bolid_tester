/** Render a screen inside the app's real Tamagui provider + dark theme, as `_layout.tsx` does. */
import React from 'react';
import { render } from '@testing-library/react-native';
import { TamaguiProvider, Theme } from 'tamagui';
import config from '../tamagui.config';

export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <TamaguiProvider config={config} defaultTheme="dark">
      <Theme name="dark">{ui}</Theme>
    </TamaguiProvider>,
  );
}
