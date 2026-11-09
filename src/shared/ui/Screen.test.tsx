/** The screen frame (plan 21): a centred, width-capped column with roomier padding on tablets. */
import React from 'react';
import { ScrollView } from 'react-native';
import { screen } from '@testing-library/react-native';
import { Paragraph } from 'tamagui';
import { renderWithProviders } from '@test/renderWithProviders';
import { setMockWindow, TABLET_WINDOW } from '@test/mocks/window';
import { Screen } from './Screen';

function padding(): unknown {
  return screen.UNSAFE_getByType(ScrollView).props.contentContainerStyle;
}

describe('Screen', () => {
  it('a phone: full-width content, 16 dp padding, inputs kept above the keyboard', () => {
    renderWithProviders(
      <Screen title="Title">
        <Paragraph>Body</Paragraph>
      </Screen>,
    );
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByTestId('screen-content')).not.toHaveStyle({ maxWidth: 1100 });
    expect(padding()).toEqual({ padding: 16 });
    expect(screen.UNSAFE_getByType(ScrollView).props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('a tablet: the content is a centred column capped at 1100 dp, 24 dp padding', () => {
    setMockWindow(TABLET_WINDOW);
    renderWithProviders(
      <Screen title="Title">
        <Paragraph>Body</Paragraph>
      </Screen>,
    );
    expect(screen.getByTestId('screen-content')).toHaveStyle({
      maxWidth: 1100,
      alignSelf: 'center',
    });
    expect(padding()).toEqual({ padding: 24 });
  });

  it('a tablet with `wide`: no cap', () => {
    setMockWindow(TABLET_WINDOW);
    renderWithProviders(
      <Screen title="Title" wide>
        <Paragraph>Body</Paragraph>
      </Screen>,
    );
    expect(screen.getByTestId('screen-content')).not.toHaveStyle({ maxWidth: 1100 });
    expect(padding()).toEqual({ padding: 24 });
  });
});
